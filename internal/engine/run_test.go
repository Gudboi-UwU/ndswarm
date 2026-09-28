package engine

import (
	"context"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/Gudboi-UwU/ndswarm/internal/dummy"
	"github.com/Gudboi-UwU/ndswarm/internal/metrics"
	"github.com/Gudboi-UwU/ndswarm/internal/model"
)

func endpoint(name, url string) model.Flow {
	return model.Flow{ID: name, Name: name, Enabled: true, Weight: 1, Steps: []model.Step{{
		ID: name, Name: name, Enabled: true, Method: "GET", URL: url, TimeoutMs: 5000, FollowRedirects: true, Body: model.Body{Type: "none"},
	}}}
}

// TestRun is the M3 acceptance check: 5 seconds against the dummy target.
func TestRun(t *testing.T) {
	if testing.Short() {
		t.Skip("5 second run")
	}
	srv := httptest.NewServer(dummy.Handler())
	defer srv.Close()

	test := model.Test{
		Name:     "acceptance",
		Flows:    []model.Flow{endpoint("fast", "/fast"), endpoint("flaky", "/flaky?err=0.2"), endpoint("slow", "/slow?ms=50")},
		Load:     model.Load{Stages: []model.Stage{{DurationSec: 1, Target: 20}, {DurationSec: 4, Target: 20}}, GracefulStopSec: 5},
		Settings: model.DefaultSettings,
	}
	test.Normalize()
	if err := test.Validate(); err != nil {
		t.Fatal(err)
	}
	plan, err := NewPlan(test, &model.Environment{BaseURL: srv.URL})
	if err != nil {
		t.Fatal(err)
	}
	rec := metrics.NewRecorder(len(plan.Keys))
	var ticks []Tick
	start := time.Now()
	Run(context.Background(), plan, rec, func(tk Tick) { ticks = append(ticks, tk) })
	took := time.Since(start)

	if took < 5*time.Second || took > 7*time.Second {
		t.Errorf("run took %v, want about 5s", took)
	}
	if len(ticks) < 5 || len(ticks) > 7 {
		t.Errorf("%d ticks, want about one per second", len(ticks))
	}
	peak := 0
	for _, tk := range ticks {
		peak = max(peak, tk.VUs)
	}
	if peak != 20 {
		t.Errorf("peak VUs %d, want 20", peak)
	}
	last := ticks[len(ticks)-1].Snap
	byName := map[string]metrics.Stats{}
	for _, k := range last.Keys {
		byName[plan.Keys[k.Key].Flow] = k.Total
	}
	for _, name := range []string{"fast", "flaky", "slow"} {
		if byName[name].Count == 0 {
			t.Errorf("%s: no requests", name)
		}
	}
	flaky := byName["flaky"]
	if ratio := float64(flaky.Err) / float64(flaky.Count); ratio < 0.15 || ratio > 0.25 {
		t.Errorf("flaky error ratio %.3f over %d requests, want 0.2 +- 0.05", ratio, flaky.Count)
	}
	if avg := byName["slow"].Avg; avg < 50 || avg > 70 {
		t.Errorf("slow avg %.1f ms, want 50-70", avg)
	}
	if byName["fast"].Err != 0 || byName["slow"].Err != 0 {
		t.Errorf("unexpected errors: fast %+v slow %+v", byName["fast"], byName["slow"])
	}
	if last.Total.Count != byName["fast"].Count+byName["flaky"].Count+byName["slow"].Count {
		t.Error("total does not add up to the keys")
	}
	t.Logf("total %d requests, %.0f rps; fast avg %.2f ms", last.Total.Count, last.Total.RPS, byName["fast"].Avg)
}

// TestRunCancel: a cancelled run stops quickly even with slow requests in flight.
func TestRunCancel(t *testing.T) {
	srv := httptest.NewServer(dummy.Handler())
	defer srv.Close()
	test := model.Test{Name: "c", Flows: []model.Flow{endpoint("slow", "/slow?ms=3000")},
		Load: model.Load{Stages: []model.Stage{{DurationSec: 60, Target: 5}}, GracefulStopSec: 30}, Settings: model.DefaultSettings}
	test.Normalize()
	plan, err := NewPlan(test, &model.Environment{BaseURL: srv.URL})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	time.AfterFunc(500*time.Millisecond, cancel)
	start := time.Now()
	var last Tick
	Run(ctx, plan, metrics.NewRecorder(len(plan.Keys)), func(tk Tick) { last = tk })
	if d := time.Since(start); d > 2*time.Second {
		t.Errorf("cancel took %v", d)
	}
	if last.Snap.Total.Count != 0 || last.Snap.Total.Err != 0 {
		t.Errorf("interrupted requests were counted: %+v", last.Snap.Total)
	}
}

func TestTargetAt(t *testing.T) {
	l := model.Load{Stages: []model.Stage{{DurationSec: 10, Target: 100}, {DurationSec: 10, Target: 100}, {DurationSec: 10, Target: 0}}}
	for e, want := range map[float64]int{0: 0, 5: 50, 10: 100, 15: 100, 25: 50, 30: 0, 99: 0} {
		if got := l.TargetAt(e); got != want {
			t.Errorf("TargetAt(%v) = %d, want %d", e, got, want)
		}
	}
}
