package runner

import (
	"github.com/Gudboi-UwU/ndswarm/internal/metrics"
	"github.com/Gudboi-UwU/ndswarm/internal/model"
)

// ThresholdResult is one rule checked against a run's final totals.
type ThresholdResult struct {
	Metric string  `json:"metric"`
	Op     string  `json:"op"`
	Value  float64 `json:"value"`
	Actual float64 `json:"actual"`
	Passed bool    `json:"passed"`
}

// metricValue reads the one number a rule's metric refers to, from the whole run's total stats.
func metricValue(metric string, s metrics.Stats) float64 {
	switch metric {
	case "failed_pct":
		if s.Count == 0 {
			return 0
		}
		return float64(s.Err) / float64(s.Count) * 100
	case "avg_ms":
		return s.Avg
	case "p95_ms":
		return s.P95
	case "p99_ms":
		return s.P99
	case "max_ms":
		return s.Max
	case "rps":
		return s.RPS
	default:
		return 0
	}
}

func compare(op string, actual, value float64) bool {
	switch op {
	case "<":
		return actual < value
	case "<=":
		return actual <= value
	case ">":
		return actual > value
	case ">=":
		return actual >= value
	default:
		return false
	}
}

// EvaluateThresholds checks every rule against s and reports whether all of them passed.
func EvaluateThresholds(rules []model.Threshold, s metrics.Stats) ([]ThresholdResult, bool) {
	all := true
	out := make([]ThresholdResult, 0, len(rules))
	for _, r := range rules {
		actual := metricValue(r.Metric, s)
		passed := compare(r.Op, actual, r.Value)
		all = all && passed
		out = append(out, ThresholdResult{Metric: r.Metric, Op: r.Op, Value: r.Value, Actual: actual, Passed: passed})
	}
	return out, all
}
