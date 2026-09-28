package logsink

import (
	"math/rand/v2"
	"path/filepath"
	"testing"

	"github.com/Gudboi-UwU/ndswarm/internal/store"
)

func TestCaps(t *testing.T) {
	db, err := store.Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	db.W.Exec(`INSERT INTO runs (id, test_name, config_json, keys_json, status, started_at, created_by) VALUES (1, 't', '{}', '[]', 'running', 0, 'x')`)

	s := New(db, 1, 2, 100) // log every success, within caps
	r := rand.New(rand.NewPCG(1, 2))
	reasons := map[string]int{}
	for i := range 100 { // one second on key 0: 100 errors
		msg := "dial tcp 127.0.0.1:" + string(rune('0'+i%10)) + ": connection refused"
		s.CountError(0, "connection", msg, 0)
		if reason := s.Want(0, "connection", 1, r); reason != "" {
			reasons[reason]++
			s.Add(&Entry{Key: 0, Category: "connection", Reason: reason, Error: msg, LatencyMs: 1})
		}
	}
	for i := range 100 { // and 100 successes on key 1, the last one slowest
		lat := float64(i%10 + 1)
		if i == 99 {
			lat = 500
		}
		if reason := s.Want(1, "", lat, r); reason != "" {
			reasons[reason]++
			s.Add(&Entry{Key: 1, Reason: reason, LatencyMs: lat, Request: &Request{Method: "GET", URL: "http://x"}})
		}
	}
	if reasons["error"] != ErrorsPerKeySec || reasons["sample"] != SamplesPerKeySec {
		t.Errorf("reasons %v", reasons)
	}
	if got := s.Dropped(); got != 50+80 {
		t.Errorf("dropped %d, want 130 (50 errors + 80 samples over quota)", got)
	}
	s.Tick() // new second: quotas reset
	if s.Want(0, "connection", 1, r) != "error" {
		t.Error("quota did not reset")
	}
	s.Close()

	var rows, slowest int
	db.R.QueryRow("SELECT count(*) FROM request_logs WHERE run_id = 1").Scan(&rows)
	db.R.QueryRow("SELECT count(*) FROM request_logs WHERE reason = 'slowest' AND latency_ms = 500").Scan(&slowest)
	if rows != 50+20+1 || slowest != 1 {
		t.Errorf("stored %d rows (%d slowest at 500ms), want 71 with the 500ms one", rows, slowest)
	}
	var count int64
	var example *int64
	db.R.QueryRow("SELECT count, example_log_id FROM error_groups WHERE run_id = 1 AND message = 'dial tcp N.N.N.N:N: connection refused'").Scan(&count, &example)
	if count != 100 || example == nil {
		t.Errorf("error group count %d example %v; every error counts, logged or not", count, example)
	}
	var blob []byte
	db.R.QueryRow("SELECT detail FROM request_logs WHERE key_id = 1 LIMIT 1").Scan(&blob)
	if req, _, err := Decompress(blob); err != nil || req.URL != "http://x" {
		t.Errorf("detail round trip: %v %+v", err, req)
	}
}

func TestQueueFullDrops(t *testing.T) {
	s := &Sink{queue: make(chan *Entry, 1)}
	s.enqueue(&Entry{})
	s.enqueue(&Entry{}) // full: must not block
	if s.Dropped() != 1 {
		t.Errorf("dropped %d", s.Dropped())
	}
}
