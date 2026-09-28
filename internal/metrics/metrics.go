// Package metrics records request results per statistic key and aggregates them every second.
package metrics

import (
	"strconv"
	"sync"

	hdr "github.com/HdrHistogram/hdrhistogram-go"
)

// Histogram range: 1 µs to 5 minutes, 3 significant digits.
const (
	lowestUs  = 1
	highestUs = 300_000_000
	sigDigits = 3
	recentSec = 5
)

// Sample is one finished request.
type Sample struct {
	LatencyUs int64
	Status    int    // 0 when no response
	Category  string // "" when OK; otherwise http_4xx, http_5xx, timeout, connection, dns, tls, template
	BytesIn   int64
	BytesOut  int64
	DNS       float64 // phase durations in ms
	Connect   float64
	TLS       float64
	TTFB      float64
	Download  float64
}

// Stats is what the UI shows for a key or the whole run over some window.
type Stats struct {
	Count    int64   `json:"count"`
	OK       int64   `json:"ok"`
	Err      int64   `json:"err"`
	Avg      float64 `json:"avg"` // ms
	Min      float64 `json:"min"`
	Max      float64 `json:"max"`
	P50      float64 `json:"p50"`
	P90      float64 `json:"p90"`
	P95      float64 `json:"p95"`
	P99      float64 `json:"p99"`
	RPS      float64 `json:"rps"`
	BytesIn  int64   `json:"bytesIn"`
	BytesOut int64   `json:"bytesOut"`
}

// Phases are average phase durations in ms for requests in a window.
type Phases struct {
	DNS      float64 `json:"dns"`
	Connect  float64 `json:"connect"`
	TLS      float64 `json:"tls"`
	TTFB     float64 `json:"ttfb"`
	Download float64 `json:"download"`
}

// window accumulates samples; latency lives in hist, everything else in plain counters.
type window struct {
	hist                              *hdr.Histogram
	count, ok, err, bytesIn, bytesOut int64
	sumMs                             float64
	dns, connect, tls, ttfb, download float64
	codes                             map[string]int64 // status code or error category -> count
}

func newWindow() *window {
	return &window{hist: hdr.New(lowestUs, highestUs, sigDigits), codes: map[string]int64{}}
}

func (w *window) add(s Sample) {
	w.count++
	if s.Category == "" {
		w.ok++
	} else {
		w.err++
		w.codes[s.Category]++
	}
	if s.Status != 0 {
		w.codes[strconv.Itoa(s.Status)]++
	}
	if s.LatencyUs > 0 { // template errors never sent a request
		w.hist.RecordValue(min(max(s.LatencyUs, lowestUs), highestUs))
		w.sumMs += float64(s.LatencyUs) / 1000
	}
	w.bytesIn += s.BytesIn
	w.bytesOut += s.BytesOut
	w.dns += s.DNS
	w.connect += s.Connect
	w.tls += s.TLS
	w.ttfb += s.TTFB
	w.download += s.Download
}

func (w *window) merge(o *window) {
	if o.count == 0 {
		return
	}
	w.hist.Merge(o.hist)
	w.count += o.count
	w.ok += o.ok
	w.err += o.err
	w.bytesIn += o.bytesIn
	w.bytesOut += o.bytesOut
	w.sumMs += o.sumMs
	w.dns += o.dns
	w.connect += o.connect
	w.tls += o.tls
	w.ttfb += o.ttfb
	w.download += o.download
	for k, v := range o.codes {
		w.codes[k] += v
	}
}

func (w *window) reset() {
	w.hist.Reset()
	w.count, w.ok, w.err, w.bytesIn, w.bytesOut = 0, 0, 0, 0, 0
	w.sumMs, w.dns, w.connect, w.tls, w.ttfb, w.download = 0, 0, 0, 0, 0, 0
	clear(w.codes)
}

// stats summarizes w; seconds is the window length used for RPS.
func (w *window) stats(seconds float64) Stats {
	s := Stats{Count: w.count, OK: w.ok, Err: w.err, BytesIn: w.bytesIn, BytesOut: w.bytesOut}
	if seconds > 0 {
		s.RPS = float64(w.count) / seconds
	}
	if n := w.hist.TotalCount(); n > 0 {
		s.Avg = w.sumMs / float64(n)
		s.Min = ms(w.hist.Min())
		s.Max = ms(w.hist.Max())
		s.P50 = ms(w.hist.ValueAtQuantile(50))
		s.P90 = ms(w.hist.ValueAtQuantile(90))
		s.P95 = ms(w.hist.ValueAtQuantile(95))
		s.P99 = ms(w.hist.ValueAtQuantile(99))
	}
	return s
}

func (w *window) phases() Phases {
	n := float64(w.hist.TotalCount())
	if n == 0 {
		return Phases{}
	}
	return Phases{w.dns / n, w.connect / n, w.tls / n, w.ttfb / n, w.download / n}
}

func ms(us int64) float64 { return float64(us) / 1000 }

type key struct {
	mu    sync.Mutex
	cur   *window // written by VUs
	spare *window // swapped in at each tick so VUs never wait on aggregation
	total *window // cumulative, touched only by Tick
}

// Recorder is safe for concurrent Record calls; Tick must be called from one goroutine.
type Recorder struct {
	keys    []*key
	overall *window   // cumulative across keys
	recent  []*window // last recentSec one-second windows across keys, ring
	next    int
	sec     *window // scratch for the current second across keys
}

func NewRecorder(keys int) *Recorder {
	r := &Recorder{overall: newWindow(), sec: newWindow()}
	for range keys {
		r.keys = append(r.keys, &key{cur: newWindow(), spare: newWindow(), total: newWindow()})
	}
	for range recentSec {
		r.recent = append(r.recent, newWindow())
	}
	return r
}

func (r *Recorder) Record(k int, s Sample) {
	kr := r.keys[k]
	kr.mu.Lock()
	kr.cur.add(s)
	kr.mu.Unlock()
}

// KeyStats is one key's numbers in a snapshot.
type KeyStats struct {
	Key    int    `json:"keyId"`
	Total  Stats  `json:"total"`
	Second Stats  `json:"second"`
	Phases Phases `json:"phases"` // this second
}

// Snapshot is the state after one Tick.
type Snapshot struct {
	Second       Stats            `json:"second"` // the last second, all keys
	SecondPhases Phases           `json:"secondPhases"`
	Total        Stats            `json:"total"` // since start
	Recent       Stats            `json:"recent5s"`
	Keys         []KeyStats       `json:"keys"`
	Codes        map[string]int64 `json:"codes"` // cumulative status codes and error categories
}

// Tick closes the current second. elapsed is seconds since the run started (for total RPS).
func (r *Recorder) Tick(elapsed float64) Snapshot {
	r.sec.reset()
	snap := Snapshot{Keys: make([]KeyStats, 0, len(r.keys))}
	for i, kr := range r.keys {
		kr.mu.Lock()
		w := kr.cur
		kr.cur, kr.spare = kr.spare, kr.cur
		kr.mu.Unlock()

		kr.total.merge(w)
		r.sec.merge(w)
		if kr.total.count > 0 {
			snap.Keys = append(snap.Keys, KeyStats{Key: i, Total: kr.total.stats(elapsed), Second: w.stats(1), Phases: w.phases()})
		}
		w.reset() // w is now the spare
	}
	r.overall.merge(r.sec)
	ring := r.recent[r.next]
	ring.reset()
	ring.merge(r.sec)
	r.next = (r.next + 1) % recentSec

	recent := newWindow()
	for _, w := range r.recent {
		recent.merge(w)
	}
	snap.Second = r.sec.stats(1)
	snap.SecondPhases = r.sec.phases()
	snap.Total = r.overall.stats(elapsed)
	snap.Recent = recent.stats(min(recentSec, max(elapsed, 1)))
	snap.Codes = make(map[string]int64, len(r.overall.codes))
	for k, v := range r.overall.codes {
		snap.Codes[k] = v
	}
	return snap
}

// KeyCodes returns cumulative status codes and error categories for key k (after the last Tick).
func (r *Recorder) KeyCodes(k int) map[string]int64 { return r.keys[k].total.codes }

// KeyHistogram and Histogram return encoded cumulative histograms for storage.
func (r *Recorder) KeyHistogram(k int) ([]byte, error) { return encode(r.keys[k].total.hist) }
func (r *Recorder) Histogram() ([]byte, error)         { return encode(r.overall.hist) }

func encode(h *hdr.Histogram) ([]byte, error) {
	return h.Encode(hdr.V2CompressedEncodingCookieBase)
}
