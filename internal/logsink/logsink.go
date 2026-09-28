// Package logsink decides which requests of a run are logged and writes them in batches.
//
// Per statistic key and second: every error up to 50, sampled successes up to 20, plus the
// slowest request. Everything over quota, and anything that finds the write queue full, is
// counted as dropped. Logging never blocks a virtual user.
package logsink

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"log/slog"
	"math/rand/v2"
	"net/http"
	"regexp"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/Gudboi-UwU/ndswarm/internal/store"
)

const (
	ErrorsPerKeySec  = 50
	SamplesPerKeySec = 20
	MaxGroupsPerKey  = 100
	queueSize        = 4096
	batchSize        = 500
)

type Timing struct {
	DNS      float64 `json:"dns"`
	Connect  float64 `json:"connect"`
	TLS      float64 `json:"tls"`
	TTFB     float64 `json:"ttfb"`
	Download float64 `json:"download"`
	Total    float64 `json:"total"`
	Reused   bool    `json:"reused"`
}

type Request struct {
	Method    string      `json:"method"`
	URL       string      `json:"url"`
	Headers   http.Header `json:"headers"`
	Body      string      `json:"body"`
	BodySize  int         `json:"bodySize"`
	Truncated bool        `json:"truncated"`
}

type Response struct {
	Status    int         `json:"status"`
	Headers   http.Header `json:"headers"`
	Body      string      `json:"body"`
	BodySize  int64       `json:"bodySize"`
	Truncated bool        `json:"truncated"`
}

// Entry is one logged request, already redacted by the caller.
type Entry struct {
	TMs       int64
	Sec       int64
	VU        int
	Iter      int64
	Key       int
	Status    int
	Category  string
	LatencyMs float64
	Reason    string // error | sample | slowest
	Error     string
	Timing    Timing
	Request   *Request  // nil when the request could not be rendered
	Response  *Response // nil when no response arrived
}

type keyState struct {
	mu      sync.Mutex
	errors  int
	samples int
	slowMs  float64
	slow    *Entry
	groups  map[groupKey]*Group
}

type groupKey struct{ category, message string }

// Group counts every error of one kind for a key, logged or not.
type Group struct {
	Key          int    `json:"keyId"`
	Category     string `json:"category"`
	Message      string `json:"message"`
	Count        int64  `json:"count"`
	ExampleLogID *int64 `json:"exampleLogId"`
	FirstSec     int64  `json:"firstSec"`
	LastSec      int64  `json:"lastSec"`
}

type Sink struct {
	db      *store.Store
	runID   int64
	pct     float64
	keys    []*keyState
	queue   chan *Entry
	dropped atomic.Int64
	done    chan struct{}
}

// New starts the writer. pct is the percentage of successful requests to consider for logging.
func New(db *store.Store, runID int64, keys int, pct float64) *Sink {
	s := &Sink{db: db, runID: runID, pct: pct, queue: make(chan *Entry, queueSize), done: make(chan struct{})}
	for range keys {
		s.keys = append(s.keys, &keyState{groups: map[groupKey]*Group{}})
	}
	go s.write()
	return s
}

// Want says whether a finished request should be logged: "error", "sample", "slowest" or "".
// Build the Entry only when it returns non-empty, then pass it to Add.
func (s *Sink) Want(key int, category string, latencyMs float64, r *rand.Rand) string {
	k := s.keys[key]
	sampled := category == "" && s.pct > 0 && r.Float64()*100 < s.pct
	k.mu.Lock()
	defer k.mu.Unlock()
	switch {
	case category != "":
		if k.errors < ErrorsPerKeySec {
			k.errors++
			k.slowMs = max(k.slowMs, latencyMs) // a logged request also covers "slowest"
			return "error"
		}
		s.dropped.Add(1)
	case sampled:
		if k.samples < SamplesPerKeySec {
			k.samples++
			k.slowMs = max(k.slowMs, latencyMs)
			return "sample"
		}
		s.dropped.Add(1)
	}
	if latencyMs > k.slowMs {
		k.slowMs = latencyMs
		return "slowest"
	}
	return ""
}

// Add queues e. A "slowest" entry only becomes this second's candidate for its key.
func (s *Sink) Add(e *Entry) {
	if e.Reason == "slowest" {
		k := s.keys[e.Key]
		k.mu.Lock()
		if k.slow == nil || e.LatencyMs >= k.slow.LatencyMs {
			k.slow = e
		}
		k.mu.Unlock()
		return
	}
	s.enqueue(e)
}

func (s *Sink) enqueue(e *Entry) {
	select {
	case s.queue <- e:
	default:
		s.dropped.Add(1)
	}
}

var numbers = regexp.MustCompile(`0x[0-9a-fA-F]+|\d+`)

func normalize(message string) string {
	msg := numbers.ReplaceAllString(message, "N")
	if len(msg) > 300 {
		msg = msg[:300]
	}
	return msg
}

// CountError adds one error to its group. The message is normalized ("port 51234" -> "port N").
func (s *Sink) CountError(key int, category, message string, sec int64) {
	msg := normalize(message)
	k := s.keys[key]
	k.mu.Lock()
	defer k.mu.Unlock()
	g := k.groups[groupKey{category, msg}]
	if g == nil {
		if len(k.groups) >= MaxGroupsPerKey {
			msg = "(other messages)"
			g = k.groups[groupKey{category, msg}]
		}
		if g == nil {
			g = &Group{Key: key, Category: category, Message: msg, FirstSec: sec}
			k.groups[groupKey{category, msg}] = g
		}
	}
	g.Count++
	g.LastSec = sec
}

// Tick closes a second: queues each key's slowest request and resets the quotas.
func (s *Sink) Tick() {
	for _, k := range s.keys {
		k.mu.Lock()
		slow := k.slow
		k.slow, k.errors, k.samples, k.slowMs = nil, 0, 0, 0
		k.mu.Unlock()
		if slow != nil {
			s.enqueue(slow)
		}
	}
}

// Dropped is how many requests qualified for logging but were not written.
func (s *Sink) Dropped() int64 { return s.dropped.Load() }

// Groups returns a copy of the error groups, largest first.
func (s *Sink) Groups() []Group {
	var out []Group
	for _, k := range s.keys {
		k.mu.Lock()
		for _, g := range k.groups {
			out = append(out, *g)
		}
		k.mu.Unlock()
	}
	slices.SortFunc(out, func(a, b Group) int {
		if a.Count != b.Count {
			return int(b.Count - a.Count)
		}
		return strings.Compare(a.Message, b.Message)
	})
	return out
}

// Close flushes everything and stores the error groups.
func (s *Sink) Close() {
	s.Tick()
	close(s.queue)
	<-s.done
	groups := s.Groups()
	tx, err := s.db.W.Begin()
	if err != nil {
		slog.Error("error groups", "run", s.runID, "err", err)
		return
	}
	defer tx.Rollback()
	for _, g := range groups {
		if _, err := tx.Exec(`INSERT INTO error_groups (run_id, key_id, category, message, count, example_log_id, first_sec, last_sec)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, s.runID, g.Key, g.Category, g.Message, g.Count, g.ExampleLogID, g.FirstSec, g.LastSec); err != nil {
			slog.Error("error groups", "run", s.runID, "err", err)
			return
		}
	}
	tx.Commit()
}

// write batches queued entries: every second or every batchSize entries, one transaction.
func (s *Sink) write() {
	defer close(s.done)
	batch := make([]*Entry, 0, batchSize)
	flush := time.NewTicker(time.Second)
	defer flush.Stop()
	for {
		select {
		case e, ok := <-s.queue:
			if !ok {
				s.insert(batch)
				return
			}
			if batch = append(batch, e); len(batch) >= batchSize {
				s.insert(batch)
				batch = batch[:0]
			}
		case <-flush.C:
			s.insert(batch)
			batch = batch[:0]
		}
	}
}

func (s *Sink) insert(batch []*Entry) {
	if len(batch) == 0 {
		return
	}
	tx, err := s.db.W.Begin()
	if err != nil {
		slog.Error("write logs", "run", s.runID, "err", err)
		s.dropped.Add(int64(len(batch)))
		return
	}
	defer tx.Rollback()
	stmt, err := tx.Prepare(`INSERT INTO request_logs (run_id, t_ms, sec, vu, iter, key_id, status, category, latency_ms, reason, error, timing_json, detail)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
	if err != nil {
		slog.Error("write logs", "run", s.runID, "err", err)
		return
	}
	defer stmt.Close()
	for _, e := range batch {
		timing, _ := json.Marshal(e.Timing)
		res, err := stmt.Exec(s.runID, e.TMs, e.Sec, e.VU, e.Iter, e.Key, e.Status, e.Category, e.LatencyMs, e.Reason, e.Error, string(timing), compress(e))
		if err != nil {
			slog.Error("write log", "run", s.runID, "err", err)
			continue
		}
		if e.Category != "" {
			id, _ := res.LastInsertId()
			s.setExample(e, id)
		}
	}
	if err := tx.Commit(); err != nil {
		slog.Error("write logs", "run", s.runID, "err", err)
	}
}

// setExample links the first logged request of an error group to it.
func (s *Sink) setExample(e *Entry, id int64) {
	msg := normalize(e.Error)
	k := s.keys[e.Key]
	k.mu.Lock()
	if g := k.groups[groupKey{e.Category, msg}]; g != nil && g.ExampleLogID == nil {
		g.ExampleLogID = &id
	}
	k.mu.Unlock()
}

type detail struct {
	Request  *Request  `json:"request"`
	Response *Response `json:"response"`
}

func compress(e *Entry) []byte {
	var b bytes.Buffer
	zw, _ := gzip.NewWriterLevel(&b, gzip.BestSpeed)
	json.NewEncoder(zw).Encode(detail{e.Request, e.Response})
	zw.Close()
	return b.Bytes()
}

// Decompress reads a stored detail blob.
func Decompress(blob []byte) (req *Request, resp *Response, err error) {
	zr, err := gzip.NewReader(bytes.NewReader(blob))
	if err != nil {
		return nil, nil, err
	}
	var d detail
	err = json.NewDecoder(zr).Decode(&d)
	return d.Request, d.Response, err
}
