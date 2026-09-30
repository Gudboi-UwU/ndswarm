package model

import (
	"errors"
	"math"
	"testing"
)

func TestValidateThresholds(t *testing.T) {
	base := func(ts ...Threshold) Test {
		tt := Test{Name: "t", Flows: []Flow{{ID: "f", Name: "f", Enabled: true, Weight: 1, Steps: []Step{{
			ID: "s", Name: "s", Enabled: true, Method: "GET", URL: "/x", Body: Body{Type: "none"},
		}}}}, Thresholds: ts}
		tt.Normalize()
		return tt
	}
	paths := func(tt Test) map[string]bool {
		var v ValidationError
		if err := tt.Validate(); err != nil && !errors.As(err, &v) {
			t.Fatal(err)
		}
		out := map[string]bool{}
		for _, e := range v {
			out[e.Path] = true
		}
		return out
	}

	ok := base(Threshold{ID: "a", Metric: "failed_pct", Op: "<", Value: 1})
	if got := paths(ok); len(got) != 0 {
		t.Errorf("valid rule rejected: %v", got)
	}
	ok2 := base(Threshold{ID: "a", Metric: "failed_pct", Op: "<=", Value: 100}, Threshold{ID: "b", Metric: "avg_ms", Op: "<", Value: 5000})
	if got := paths(ok2); len(got) != 0 {
		t.Errorf("valid rules rejected: %v", got)
	}

	cases := []struct {
		name string
		tt   Test
		want string
	}{
		{"missing id", base(Threshold{Metric: "avg_ms", Op: "<", Value: 1}), "thresholds.0.id"},
		{"duplicate id", base(Threshold{ID: "a", Metric: "avg_ms", Op: "<", Value: 1}, Threshold{ID: "a", Metric: "rps", Op: ">", Value: 1}), "thresholds.1.id"},
		{"bad metric", base(Threshold{ID: "a", Metric: "bogus", Op: "<", Value: 1}), "thresholds.0.metric"},
		{"bad op", base(Threshold{ID: "a", Metric: "avg_ms", Op: "~=", Value: 1}), "thresholds.0.op"},
		{"negative value", base(Threshold{ID: "a", Metric: "avg_ms", Op: "<", Value: -1}), "thresholds.0.value"},
		{"NaN value", base(Threshold{ID: "a", Metric: "avg_ms", Op: "<", Value: math.NaN()}), "thresholds.0.value"},
		{"Inf value", base(Threshold{ID: "a", Metric: "avg_ms", Op: "<", Value: math.Inf(1)}), "thresholds.0.value"},
		{"failed_pct over 100", base(Threshold{ID: "a", Metric: "failed_pct", Op: "<", Value: 101}), "thresholds.0.value"},
	}
	for _, c := range cases {
		if got := paths(c.tt); !got[c.want] {
			t.Errorf("%s: got %v, want %s", c.name, got, c.want)
		}
	}

	// Over the limit.
	var many []Threshold
	for i := 0; i <= MaxThresholds; i++ {
		many = append(many, Threshold{ID: string(rune('a' + i)), Metric: "rps", Op: ">", Value: 1})
	}
	if got := paths(base(many...)); !got["thresholds"] {
		t.Errorf("too many rules not rejected: %v", got)
	}
}

func TestNormalizeThresholdsNoNulls(t *testing.T) {
	tt := Test{Flows: []Flow{{}}}
	tt.Normalize()
	if tt.Thresholds == nil {
		t.Error("nil thresholds left")
	}
}
