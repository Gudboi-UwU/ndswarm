package model

import (
	"errors"
	"slices"
	"testing"
)

func TestValidateFields(t *testing.T) {
	base := func(bodyType string, fields ...Field) Test {
		tt := Test{Name: "t", Flows: []Flow{{ID: "f", Name: "f", Enabled: true, Weight: 1, Steps: []Step{{
			ID: "s", Name: "s", Enabled: true, Method: "post", URL: "/x",
			Body: Body{Type: bodyType, Variants: []Variant{{ID: "v", Name: "v", Enabled: true, Fields: fields}}},
		}}}}}
		tt.Normalize()
		return tt
	}
	paths := func(tt Test) []string {
		var v ValidationError
		if err := tt.Validate(); err != nil && !errors.As(err, &v) {
			t.Fatal(err)
		}
		out := []string{}
		for _, e := range v {
			out = append(out, e.Path)
		}
		return out
	}
	const p = "flows.0.steps.0.body.variants.0.fields."

	ok := base("json",
		Field{Key: "tags", Type: "array", ArrayLen: &MinMax{1, 3}, Children: []Field{{Type: "object", Children: []Field{{Key: "id", Type: "integer", Value: "{{int 1 9}}"}}}}},
		Field{Key: "n", Type: "null"})
	if got := paths(ok); len(got) != 0 {
		t.Errorf("valid test rejected: %v", got)
	}
	if ok.Flows[0].Steps[0].Method != "POST" || ok.Flows[0].Steps[0].TimeoutMs != DefaultTimeout {
		t.Error("Normalize did not fill defaults")
	}

	cases := []struct {
		name string
		tt   Test
		want string
	}{
		{"duplicate key", base("json", Field{Key: "a", Type: "string"}, Field{Key: "a", Type: "string"}), p + "1.key"},
		{"empty key", base("json", Field{Type: "string"}), p + "0.key"},
		{"array without item", base("json", Field{Key: "a", Type: "array", ArrayLen: &MinMax{0, 1}}), p + "0.children"},
		{"array bad length", base("json", Field{Key: "a", Type: "array", ArrayLen: &MinMax{3, 1}, Children: []Field{{Type: "string"}}}), p + "0.arrayLen"},
		{"nested form", base("form", Field{Key: "a", Type: "object"}), p + "0.type"},
		{"bad template", base("json", Field{Key: "a", Type: "string", Value: "{{int"}), p + "0.value"},
		{"unknown type", base("json", Field{Key: "a", Type: "date"}), p + "0.type"},
	}
	for _, c := range cases {
		if got := paths(c.tt); !slices.Contains(got, c.want) {
			t.Errorf("%s: got %v, want %s", c.name, got, c.want)
		}
	}
}

func TestNormalizeNoNulls(t *testing.T) {
	tt := Test{Flows: []Flow{{Steps: []Step{{Body: Body{Variants: []Variant{{Fields: []Field{{Type: "object"}}}}}}}}}}
	tt.Normalize()
	s := tt.Flows[0].Steps[0]
	if s.Query == nil || s.Headers == nil || s.Body.Variants[0].Fields[0].Children == nil {
		t.Errorf("nil slices left: %+v", s)
	}
	empty := Test{Flows: []Flow{{}}}
	empty.Normalize()
	if empty.Flows[0].Steps == nil {
		t.Error("nil steps left")
	}
}
