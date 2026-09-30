package model

import (
	"fmt"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/Gudboi-UwU/ndswarm/internal/tmpl"
)

// Limits from the plan; the UI shows the same numbers.
const (
	MaxFlows       = 100
	MaxSteps       = 20
	MaxVariants    = 20
	MaxFields      = 500 // per variant, counting nested fields
	MaxFieldDepth  = 10
	MaxArrayLen    = 1000
	MaxTimeoutMs   = 300_000
	MaxNameLen     = 100
	DefaultTimeout = 30_000
)

// Test is what the Test Builder edits. Every string value except names and keys is a template.
type Test struct {
	ID            int64       `json:"id"`
	ProjectID     int64       `json:"projectId"`
	Name          string      `json:"name"`
	Description   string      `json:"description"`
	EnvironmentID *int64      `json:"environmentId"`
	Flows         []Flow      `json:"flows"`
	Load          Load        `json:"load"`
	Settings      Settings    `json:"settings"`
	Thresholds    []Threshold `json:"thresholds"`
	UpdatedAt     int64       `json:"updatedAt"`
}

// Flow runs its steps in order. In the "Endpoints" view each flow has exactly one step.
type Flow struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Enabled bool   `json:"enabled"`
	Weight  int    `json:"weight"` // relative; the UI shows it as a percentage
	Steps   []Step `json:"steps"`
}

type Step struct {
	ID              string `json:"id"`
	Name            string `json:"name"`
	Enabled         bool   `json:"enabled"`
	Method          string `json:"method"`
	URL             string `json:"url"` // absolute, or relative to the environment's base URL
	Query           []KV   `json:"query"`
	Headers         []KV   `json:"headers"`
	Body            Body   `json:"body"`
	TimeoutMs       int    `json:"timeoutMs"`
	FollowRedirects bool   `json:"followRedirects"`
}

type KV struct {
	Key     string `json:"key"`
	Value   string `json:"value"`
	Enabled bool   `json:"enabled"`
}

type Body struct {
	Type        string    `json:"type"`        // none | json | form | multipart | raw
	VariantPick string    `json:"variantPick"` // roundRobin | random | weighted
	ContentType string    `json:"contentType"` // raw only; empty = text/plain
	Variants    []Variant `json:"variants"`
}

type Variant struct {
	ID      string  `json:"id"`
	Name    string  `json:"name"`
	Weight  int     `json:"weight"`
	Enabled bool    `json:"enabled"`
	Mode    string  `json:"mode"` // fields | raw
	Fields  []Field `json:"fields"`
	Raw     string  `json:"raw"`
}

// Field is one body key. Value is a template whose output is converted to Type.
// Objects use Children; arrays repeat Children[0] a random ArrayLen times.
type Field struct {
	Key      string  `json:"key"`
	Type     string  `json:"type"` // string | number | integer | boolean | object | array | null
	Value    string  `json:"value"`
	Children []Field `json:"children"`
	ArrayLen *MinMax `json:"arrayLen,omitempty"`
	Enabled  *bool   `json:"enabled,omitempty"` // nil = enabled
}

type MinMax struct {
	Min int `json:"min"`
	Max int `json:"max"`
}

func (f Field) IsEnabled() bool { return f.Enabled == nil || *f.Enabled }

var (
	methods     = map[string]bool{"GET": true, "POST": true, "PUT": true, "PATCH": true, "DELETE": true, "HEAD": true, "OPTIONS": true}
	bodyTypes   = map[string]bool{"none": true, "json": true, "form": true, "multipart": true, "raw": true}
	picks       = map[string]bool{"roundRobin": true, "random": true, "weighted": true}
	fieldTypes  = map[string]bool{"string": true, "number": true, "integer": true, "boolean": true, "object": true, "array": true, "null": true}
	headerToken = regexp.MustCompile("^[!#$%&'*+.^_`|~0-9A-Za-z-]+$")
)

// Normalize fills defaults so older or hand-written configs behave predictably.
func (t *Test) Normalize() {
	if t.Flows == nil {
		t.Flows = []Flow{}
	}
	t.Thresholds = nonNil(t.Thresholds)
	t.Load.normalize()
	for i := range t.Flows {
		f := &t.Flows[i]
		f.Steps = nonNil(f.Steps)
		for j := range f.Steps {
			s := &f.Steps[j]
			s.Method = strings.ToUpper(strings.TrimSpace(s.Method))
			if s.TimeoutMs == 0 {
				s.TimeoutMs = DefaultTimeout
			}
			s.Query, s.Headers = nonNil(s.Query), nonNil(s.Headers)
			s.Body.Variants = nonNil(s.Body.Variants)
			if s.Body.Type == "" {
				s.Body.Type = "none"
			}
			if s.Body.VariantPick == "" {
				s.Body.VariantPick = "roundRobin"
			}
			for k := range s.Body.Variants {
				if s.Body.Variants[k].Mode == "" {
					s.Body.Variants[k].Mode = "fields"
				}
				s.Body.Variants[k].Fields = normalizeFields(s.Body.Variants[k].Fields)
			}
		}
	}
}

// nonNil makes JSON show [] instead of null, which the UI relies on.
func nonNil[T any](s []T) []T {
	if s == nil {
		return []T{}
	}
	return s
}

func normalizeFields(fs []Field) []Field {
	fs = nonNil(fs)
	for i := range fs {
		fs[i].Children = normalizeFields(fs[i].Children)
	}
	return fs
}

// Validate reports every problem with a JSON path so the builder can mark each input.
func (t *Test) Validate() error {
	var v ValidationError
	checkName(&v, "name", t.Name)
	v.Check(len(t.Flows) <= MaxFlows, "flows", fmt.Sprintf("At most %d endpoints per test.", MaxFlows))
	t.Load.validate(&v)
	t.Settings.validate(&v)
	validateThresholds(&v, t.Thresholds)
	flowIDs := map[string]bool{}
	for i, f := range t.Flows {
		p := fmt.Sprintf("flows.%d", i)
		v.Check(f.ID != "" && !flowIDs[f.ID], p+".id", "Missing or duplicate id.")
		flowIDs[f.ID] = true
		checkName(&v, p+".name", f.Name)
		v.Check(f.Weight >= 0 && f.Weight <= 10000, p+".weight", "Use 0-10000.")
		v.Check(len(f.Steps) >= 1 && len(f.Steps) <= MaxSteps, p+".steps", fmt.Sprintf("Use 1-%d steps.", MaxSteps))
		stepIDs := map[string]bool{}
		for j, s := range f.Steps {
			sp := fmt.Sprintf("%s.steps.%d", p, j)
			v.Check(s.ID != "" && !stepIDs[s.ID], sp+".id", "Missing or duplicate id.")
			stepIDs[s.ID] = true
			validateStep(&v, sp, s)
		}
	}
	return v.Err()
}

// ValidateStep checks one step on its own (for "Try"); paths start at "step".
func ValidateStep(s Step) error {
	var v ValidationError
	validateStep(&v, "step", s)
	return v.Err()
}

// NormalizeStep fills a single step's defaults.
func NormalizeStep(s *Step) {
	t := Test{Flows: []Flow{{Steps: []Step{*s}}}}
	t.Normalize()
	*s = t.Flows[0].Steps[0]
}

func validateStep(v *ValidationError, p string, s Step) {
	checkName(v, p+".name", s.Name)
	v.Check(methods[s.Method], p+".method", "Choose GET, POST, PUT, PATCH, DELETE, HEAD or OPTIONS.")
	v.Check(strings.TrimSpace(s.URL) != "", p+".url", "Enter a URL or a path.")
	checkTemplate(v, p+".url", s.URL)
	for i, kv := range s.Query {
		kp := fmt.Sprintf("%s.query.%d", p, i)
		v.Check(!kv.Enabled || kv.Key != "", kp+".key", "Enter a name.")
		checkTemplate(v, kp+".value", kv.Value)
	}
	for i, kv := range s.Headers {
		kp := fmt.Sprintf("%s.headers.%d", p, i)
		v.Check(!kv.Enabled || headerToken.MatchString(kv.Key), kp+".key", "Enter a valid header name.")
		checkTemplate(v, kp+".value", kv.Value)
	}
	v.Check(s.TimeoutMs >= 1 && s.TimeoutMs <= MaxTimeoutMs, p+".timeoutMs", "Use 1-300000 ms.")

	b := s.Body
	v.Check(bodyTypes[b.Type], p+".body.type", "Choose none, json, form, multipart or raw.")
	v.Check(picks[b.VariantPick], p+".body.variantPick", "Choose roundRobin, random or weighted.")
	if b.Type == "none" {
		return
	}
	v.Check(len(b.Variants) >= 1 && len(b.Variants) <= MaxVariants, p+".body.variants", fmt.Sprintf("Use 1-%d variants.", MaxVariants))
	enabled := 0
	ids := map[string]bool{}
	for i, vr := range b.Variants {
		vp := fmt.Sprintf("%s.body.variants.%d", p, i)
		v.Check(vr.ID != "" && !ids[vr.ID], vp+".id", "Missing or duplicate id.")
		ids[vr.ID] = true
		checkName(v, vp+".name", vr.Name)
		v.Check(vr.Weight >= 0 && vr.Weight <= 10000, vp+".weight", "Use 0-10000.")
		if vr.Enabled {
			enabled++
		}
		switch {
		case vr.Mode == "raw":
			v.Check(b.Type == "json" || b.Type == "raw", vp+".mode", "Raw text works with JSON or raw bodies.")
			checkTemplate(v, vp+".raw", vr.Raw)
		case vr.Mode == "fields":
			count := 0
			checkFields(v, vp+".fields", vr.Fields, 1, b.Type == "json", false, &count)
			v.Check(count <= MaxFields, vp+".fields", fmt.Sprintf("At most %d fields.", MaxFields))
		default:
			v.Check(false, vp+".mode", "Choose fields or raw.")
		}
	}
	v.Check(enabled > 0 || len(b.Variants) == 0, p+".body.variants", "Enable at least one variant.")
}

// checkFields validates one level. Array item definitions (arrayItem) have no key.
func checkFields(v *ValidationError, p string, fields []Field, depth int, nested, arrayItem bool, count *int) {
	keys := map[string]bool{}
	for i, f := range fields {
		*count++
		fp := fmt.Sprintf("%s.%d", p, i)
		if !arrayItem {
			v.Check(f.Key != "", fp+".key", "Enter a key.")
			v.Check(f.Key == "" || !keys[f.Key], fp+".key", "Duplicate key.")
			keys[f.Key] = true
		}
		v.Check(fieldTypes[f.Type], fp+".type", "Choose a type.")
		if !nested {
			v.Check(f.Type != "object" && f.Type != "array", fp+".type", "Form bodies are flat: use string, number, integer, boolean or null.")
		}
		switch f.Type {
		case "object":
			v.Check(depth < MaxFieldDepth, fp+".children", "Nested too deep.")
			checkFields(v, fp+".children", f.Children, depth+1, nested, false, count)
		case "array":
			v.Check(depth < MaxFieldDepth, fp+".children", "Nested too deep.")
			v.Check(len(f.Children) == 1, fp+".children", "An array needs exactly one item definition.")
			v.Check(f.ArrayLen != nil && f.ArrayLen.Min >= 0 && f.ArrayLen.Max >= f.ArrayLen.Min && f.ArrayLen.Max <= MaxArrayLen,
				fp+".arrayLen", fmt.Sprintf("Use 0 <= min <= max <= %d.", MaxArrayLen))
			checkFields(v, fp+".children", f.Children, depth+1, nested, true, count)
		default:
			checkTemplate(v, fp+".value", f.Value)
		}
	}
}

func checkName(v *ValidationError, path, name string) {
	n := strings.TrimSpace(name)
	v.Check(n != "", path, "Enter a name.")
	v.Check(utf8.RuneCountInString(n) <= MaxNameLen, path, fmt.Sprintf("Use at most %d characters.", MaxNameLen))
}

func checkTemplate(v *ValidationError, path, src string) {
	if _, err := tmpl.Compile(src); err != nil {
		v.Check(false, path, err.Error())
	}
}
