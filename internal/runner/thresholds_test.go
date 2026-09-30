package runner

import (
	"testing"

	"github.com/Gudboi-UwU/ndswarm/internal/metrics"
	"github.com/Gudboi-UwU/ndswarm/internal/model"
)

func TestEvaluateThresholds(t *testing.T) {
	stats := metrics.Stats{Count: 100, Err: 5, Avg: 50, P95: 120, P99: 200, Max: 300, RPS: 42}
	cases := []struct {
		name   string
		rule   model.Threshold
		actual float64
		passed bool
	}{
		{"failed_pct below, passes", model.Threshold{Metric: "failed_pct", Op: "<", Value: 10}, 5, true},
		{"failed_pct below, fails", model.Threshold{Metric: "failed_pct", Op: "<", Value: 5}, 5, false},
		{"failed_pct at most, boundary passes", model.Threshold{Metric: "failed_pct", Op: "<=", Value: 5}, 5, true},
		{"avg_ms above, passes", model.Threshold{Metric: "avg_ms", Op: ">", Value: 10}, 50, true},
		{"avg_ms above, boundary fails", model.Threshold{Metric: "avg_ms", Op: ">", Value: 50}, 50, false},
		{"p95_ms at least, boundary passes", model.Threshold{Metric: "p95_ms", Op: ">=", Value: 120}, 120, true},
		{"p95_ms at least, fails", model.Threshold{Metric: "p95_ms", Op: ">=", Value: 121}, 120, false},
		{"p99_ms below, fails", model.Threshold{Metric: "p99_ms", Op: "<", Value: 100}, 200, false},
		{"max_ms at most, passes", model.Threshold{Metric: "max_ms", Op: "<=", Value: 300}, 300, true},
		{"rps at least, passes", model.Threshold{Metric: "rps", Op: ">=", Value: 42}, 42, true},
		{"rps above, fails", model.Threshold{Metric: "rps", Op: ">", Value: 42}, 42, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			results, ok := EvaluateThresholds([]model.Threshold{c.rule}, stats)
			if len(results) != 1 || results[0].Actual != c.actual || results[0].Passed != c.passed || ok != c.passed {
				t.Errorf("got %+v ok=%v, want actual=%v passed=%v", results, ok, c.actual, c.passed)
			}
		})
	}

	// No requests at all: failed_pct must not divide by zero.
	if results, ok := EvaluateThresholds([]model.Threshold{{Metric: "failed_pct", Op: "<", Value: 1}}, metrics.Stats{}); !ok || results[0].Actual != 0 {
		t.Errorf("empty stats: %+v ok=%v", results, ok)
	}

	// Any failing rule fails the whole set.
	rules := []model.Threshold{
		{Metric: "failed_pct", Op: "<", Value: 10},
		{Metric: "avg_ms", Op: "<", Value: 1}, // impossible given stats.Avg = 50
	}
	if results, ok := EvaluateThresholds(rules, stats); ok || len(results) != 2 || results[0].Passed == results[1].Passed {
		t.Errorf("mixed rules: %+v ok=%v", results, ok)
	}
}
