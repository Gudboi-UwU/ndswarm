package metrics

import (
	"math"
	"sync"
	"testing"
)

func TestRecorder(t *testing.T) {
	r := NewRecorder(2)
	var wg sync.WaitGroup
	for vu := range 8 { // concurrent writers
		wg.Go(func() {
			for i := range 1000 {
				s := Sample{LatencyUs: int64(1000 * (i%100 + 1)), Status: 200, BytesIn: 10}
				if i%10 == 0 {
					s.Status, s.Category = 500, "http_5xx"
				}
				r.Record(vu%2, s)
			}
		})
	}
	wg.Wait()
	r.Record(1, Sample{Category: "template"}) // never sent: counts, no latency

	snap := r.Tick(1)
	if snap.Second.Count != 8001 || snap.Total.Count != 8001 || snap.Total.Err != 801 || snap.Total.OK != 7200 {
		t.Fatalf("counts: second %+v total %+v", snap.Second, snap.Total)
	}
	// latencies are 1..100 ms uniformly: avg 50.5, p50 ~50, p99 ~99
	if math.Abs(snap.Total.Avg-50.5) > 0.01 || math.Abs(snap.Total.P50-50) > 0.1 || math.Abs(snap.Total.P99-99) > 0.1 || snap.Total.Min != 1 || math.Abs(snap.Total.Max-100) > 0.1 {
		t.Errorf("latency stats %+v", snap.Total)
	}
	if snap.Codes["200"] != 7200 || snap.Codes["500"] != 800 || snap.Codes["http_5xx"] != 800 || snap.Codes["template"] != 1 {
		t.Errorf("codes %v", snap.Codes)
	}
	if len(snap.Keys) != 2 || snap.Keys[1].Total.Count != 4001 {
		t.Errorf("keys %+v", snap.Keys)
	}

	// Next second: only key 0 gets traffic; cumulative totals grow, the second window resets.
	r.Record(0, Sample{LatencyUs: 5000, Status: 200})
	snap = r.Tick(2)
	if snap.Second.Count != 1 || snap.Second.Avg != 5 || snap.Total.Count != 8002 || snap.Total.RPS != 4001 {
		t.Errorf("second tick: second %+v total %+v", snap.Second, snap.Total)
	}
	if snap.Recent.Count != 8002 || snap.Recent.RPS != 4001 {
		t.Errorf("recent %+v", snap.Recent)
	}
	for range recentSec {
		r.Tick(3)
	}
	if snap = r.Tick(8); snap.Recent.Count != 0 || snap.Total.Count != 8002 {
		t.Errorf("recent window must drop old seconds: %+v", snap.Recent)
	}
	if b, err := r.Histogram(); err != nil || len(b) == 0 {
		t.Errorf("encode: %v", err)
	}
}

func TestIntervals(t *testing.T) {
	r := NewRecorder(1)
	var closed []*Interval
	for sec := 1; sec <= 25; sec++ {
		r.Record(0, Sample{LatencyUs: int64(sec) * 1000, Status: 200})
		if iv := r.Tick(float64(sec)).Interval; iv != nil {
			closed = append(closed, iv)
		}
	}
	if final := r.FinalInterval(); final != nil {
		closed = append(closed, final)
	}
	if len(closed) != 3 || closed[0].Index != 0 || closed[2].Index != 2 {
		t.Fatalf("intervals %d", len(closed))
	}
	// Bucket 0 holds seconds 1-10 (latencies 1..10 ms), bucket 1 seconds 11-20.
	_, p50, _, _, _, maxMs, err := DecodeHistogram(closed[1].HDR)
	if err != nil || math.Abs(maxMs-20) > 0.1 || p50 < 15 || p50 > 16.1 {
		t.Errorf("bucket 1: p50 %v max %v err %v", p50, maxMs, err)
	}
	merged, _ := MergeEncoded([][]byte{closed[0].HDR, closed[1].HDR})
	if _, _, _, _, _, m, _ := DecodeHistogram(merged); math.Abs(m-20) > 0.1 {
		t.Errorf("merged max %v", m)
	}
}
