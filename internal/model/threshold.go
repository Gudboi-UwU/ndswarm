package model

import (
	"fmt"
	"math"
)

// MaxThresholds caps how many pass/fail rules one test can define.
const MaxThresholds = 20

// Threshold is one pass/fail rule, checked against the run's final totals when it finishes.
type Threshold struct {
	ID     string  `json:"id"`
	Metric string  `json:"metric"` // failed_pct | avg_ms | p95_ms | p99_ms | max_ms | rps
	Op     string  `json:"op"`     // < | <= | > | >=
	Value  float64 `json:"value"`
}

var (
	thresholdMetrics = map[string]bool{"failed_pct": true, "avg_ms": true, "p95_ms": true, "p99_ms": true, "max_ms": true, "rps": true}
	thresholdOps     = map[string]bool{"<": true, "<=": true, ">": true, ">=": true}
)

func validateThresholds(v *ValidationError, ts []Threshold) {
	v.Check(len(ts) <= MaxThresholds, "thresholds", fmt.Sprintf("At most %d rules.", MaxThresholds))
	ids := map[string]bool{}
	for i, th := range ts {
		p := fmt.Sprintf("thresholds.%d", i)
		v.Check(th.ID != "" && !ids[th.ID], p+".id", "Missing or duplicate id.")
		ids[th.ID] = true
		v.Check(thresholdMetrics[th.Metric], p+".metric", "Choose a metric.")
		v.Check(thresholdOps[th.Op], p+".op", "Choose <, <=, > or >=.")
		finite := !math.IsNaN(th.Value) && !math.IsInf(th.Value, 0)
		v.Check(finite && th.Value >= 0, p+".value", "Use a number 0 or greater.")
		if finite && th.Metric == "failed_pct" {
			v.Check(th.Value <= 100, p+".value", "Use at most 100.")
		}
	}
}
