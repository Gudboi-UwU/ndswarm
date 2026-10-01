package engine_test

import (
	"strings"
	"testing"

	"github.com/Gudboi-UwU/ndswarm/internal/engine"
	"github.com/Gudboi-UwU/ndswarm/internal/model"
)

func checkStep(t *testing.T, env *model.Environment, step model.Step) []model.FieldError {
	t.Helper()
	test := model.Test{Flows: []model.Flow{{Enabled: true, Weight: 1, Steps: []model.Step{step}}}}
	c, red, err := engine.SampleCtx(env)
	if err != nil {
		t.Fatalf("SampleCtx: %v", err)
	}
	return engine.CheckTest(test, env, c, red)
}

// A bad template inside a disabled step, query row, header row or body variant must never block
// the test: the user cannot send it, so it is not worth flagging.
func TestCheckTestSkipsDisabled(t *testing.T) {
	disabledStep := model.Step{Enabled: false, URL: `{{var "missing"}}`, Body: model.Body{Type: "none"}}
	if probs := checkStep(t, nil, disabledStep); len(probs) != 0 {
		t.Errorf("disabled step: want no problems, got %v", probs)
	}

	enabledStepBadQuery := model.Step{
		Enabled: true, URL: "https://x.test/ok", Body: model.Body{Type: "none"},
		Query: []model.KV{{Key: "q", Value: `{{var "missing"}}`, Enabled: false}},
	}
	if probs := checkStep(t, nil, enabledStepBadQuery); len(probs) != 0 {
		t.Errorf("disabled query row: want no problems, got %v", probs)
	}

	enabledStepBadHeader := model.Step{
		Enabled: true, URL: "https://x.test/ok", Body: model.Body{Type: "none"},
		Headers: []model.KV{{Key: "h", Value: `{{var "missing"}}`, Enabled: false}},
	}
	if probs := checkStep(t, nil, enabledStepBadHeader); len(probs) != 0 {
		t.Errorf("disabled header row: want no problems, got %v", probs)
	}

	enabledTrue := true
	disabledVariant := model.Step{
		Enabled: true, URL: "https://x.test/ok",
		Body: model.Body{Type: "raw", Variants: []model.Variant{
			{Enabled: false, Mode: "raw", Raw: `{{var "missing"}}`},
			{Enabled: true, Mode: "fields", Fields: []model.Field{{Key: "n", Type: "string", Value: "ok", Enabled: &enabledTrue}}},
		}},
	}
	if probs := checkStep(t, nil, disabledVariant); len(probs) != 0 {
		t.Errorf("disabled variant: want no problems, got %v", probs)
	}

	disabledField := false
	stepDisabledField := model.Step{
		Enabled: true, URL: "https://x.test/ok",
		Body: model.Body{Type: "json", Variants: []model.Variant{
			{Enabled: true, Mode: "fields", Fields: []model.Field{{Key: "n", Type: "integer", Value: "not-a-number", Enabled: &disabledField}}},
		}},
	}
	if probs := checkStep(t, nil, stepDisabledField); len(probs) != 0 {
		t.Errorf("disabled field: want no problems, got %v", probs)
	}
}

// A secret variable is still a set variable (so referencing it is not flagged missing), and if
// its value would otherwise show up in an error message, it comes back redacted.
func TestCheckTestSecretVar(t *testing.T) {
	env := &model.Environment{
		Name:    "e",
		BaseURL: "https://api.example.com",
		Variables: []model.EnvVar{
			{Key: "token", Value: "s3cr3t-value", Secret: true},
			{Key: "empty", Value: "", Secret: true},
		},
	}

	// Using the secret var is fine on its own.
	ok := model.Step{Enabled: true, URL: `/x?t={{var "token"}}`, Body: model.Body{Type: "none"}}
	if probs := checkStep(t, env, ok); len(probs) != 0 {
		t.Errorf("secret var used normally: want no problems, got %v", probs)
	}

	// An empty secret var is still "set": not a missing-variable problem.
	emptyOK := model.Step{Enabled: true, URL: `/x?t={{var "empty"}}`, Body: model.Body{Type: "none"}}
	if probs := checkStep(t, env, emptyOK); len(probs) != 0 {
		t.Errorf("empty secret var: want no problems, got %v", probs)
	}

	// Force the secret's rendered value into a typed-field error message, and confirm it is redacted.
	enabled := true
	leaky := model.Step{
		Enabled: true, URL: "/x",
		Body: model.Body{Type: "json", Variants: []model.Variant{
			{Enabled: true, Mode: "fields", Fields: []model.Field{{Key: "n", Type: "integer", Value: `{{var "token"}}`, Enabled: &enabled}}},
		}},
	}
	probs := checkStep(t, env, leaky)
	if len(probs) != 1 {
		t.Fatalf("want 1 problem, got %v", probs)
	}
	if strings.Contains(probs[0].Message, "s3cr3t-value") {
		t.Errorf("secret leaked in check message: %q", probs[0].Message)
	}
	if !strings.Contains(probs[0].Message, "***") {
		t.Errorf("expected the redaction marker in message: %q", probs[0].Message)
	}
}

// A full absolute URL needs no environment at all.
func TestCheckTestAbsoluteURLNoEnv(t *testing.T) {
	step := model.Step{Enabled: true, URL: "https://other.example.com/x", Body: model.Body{Type: "none"}}
	if probs := checkStep(t, nil, step); len(probs) != 0 {
		t.Errorf("absolute URL, no env: want no problems, got %v", probs)
	}
}
