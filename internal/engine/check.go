package engine

import (
	"fmt"
	"math/rand/v2"
	"slices"
	"strings"

	"github.com/Gudboi-UwU/ndswarm/internal/model"
	"github.com/Gudboi-UwU/ndswarm/internal/tmpl"
)

// SampleCtx builds a render context from env's variables, for previews and checks that must not
// depend on a live run (no VU, no iteration). Returns a Redactor that hides env's secret values,
// including secret variables once rendered. env may be nil (no environment chosen).
func SampleCtx(env *model.Environment) (*tmpl.Ctx, Redactor, error) {
	c := tmpl.NewCtx(rand.Uint64(), nil, nil)
	if env == nil {
		return c, NewRedactor(nil), nil
	}
	vars, err := EnvVars(env, c)
	if err != nil {
		return nil, Redactor{}, err
	}
	secrets := env.SecretValues()
	for k, v := range vars {
		if env.SecretVar(k) {
			secrets = append(secrets, v)
		}
	}
	return c, NewRedactor(secrets), nil
}

// CheckTest finds template problems in every enabled flow, step, variant and field of t: parse
// errors, {{var "x"}} references the chosen environment does not have, errors from rendering
// each value once with sample data (a bad generator call, a typed field that would not fit its
// type), and a URL that cannot be resolved against the environment's address. It never sends
// HTTP requests, so it is safe to call on every edit.
//
// c must already have its Vars filled (engine.EnvVars) and red must redact env's secrets: the
// API layer's toolEnv helper builds both, the same way /tools/render and /tools/try do.
func CheckTest(t model.Test, env *model.Environment, c *tmpl.Ctx, red Redactor) []model.FieldError {
	chk := &checker{env: env, ctx: c, red: red}
	if env != nil {
		for _, v := range env.Variables {
			chk.availVars = append(chk.availVars, v.Key)
		}
	}
	for i, f := range t.Flows {
		if !f.Enabled || f.Weight <= 0 {
			continue // never picked, so it never sends
		}
		p := fmt.Sprintf("flows.%d", i)
		for j, s := range f.Steps {
			if !s.Enabled {
				continue
			}
			chk.step(fmt.Sprintf("%s.steps.%d", p, j), s)
		}
	}
	return chk.problems
}

type checker struct {
	env       *model.Environment
	ctx       *tmpl.Ctx
	red       Redactor
	availVars []string
	problems  []model.FieldError
}

func (c *checker) add(path, msg string) {
	c.problems = append(c.problems, model.FieldError{Path: path, Message: c.red.String(msg)})
}

func (c *checker) step(p string, s model.Step) {
	baseURL := ""
	if c.env != nil {
		baseURL = c.env.BaseURL
	}
	if out, ok := c.value(p+".url", s.URL); ok {
		if _, err := ResolveURL(out, baseURL); err != nil {
			c.add(p+".url", err.Error())
		}
	}
	for i, kv := range s.Query {
		if kv.Enabled {
			c.value(fmt.Sprintf("%s.query.%d.value", p, i), kv.Value)
		}
	}
	for i, kv := range s.Headers {
		if kv.Enabled {
			c.value(fmt.Sprintf("%s.headers.%d.value", p, i), kv.Value)
		}
	}
	if s.Body.Type == "none" {
		return
	}
	for i, v := range s.Body.Variants {
		if !v.Enabled {
			continue
		}
		vp := fmt.Sprintf("%s.body.variants.%d", p, i)
		if v.Mode == "raw" {
			c.value(vp+".raw", v.Raw)
		} else {
			c.fields(vp+".fields", v.Fields)
		}
	}
}

func (c *checker) fields(p string, fields []model.Field) {
	for i, f := range fields {
		if !f.IsEnabled() {
			continue
		}
		fp := fmt.Sprintf("%s.%d", p, i)
		switch f.Type {
		case "object", "array":
			c.fields(fp+".children", f.Children)
		case "null":
		default:
			if out, ok := c.value(fp+".value", f.Value); ok {
				if _, err := Typed(f.Key, f.Type, out); err != nil {
					c.add(fp+".value", err.Error())
				}
			}
		}
	}
}

// value compiles and renders src once with sample data. ok is false when src cannot be used as
// written, so the caller skips any further, type-specific check for it.
func (c *checker) value(path, src string) (out string, ok bool) {
	t, err := tmpl.Compile(src)
	if err != nil {
		c.add(path, err.Error())
		return "", false
	}
	var missing []string
	for _, name := range t.Vars() {
		if !slices.Contains(c.availVars, name) {
			missing = append(missing, name)
		}
	}
	if len(missing) > 0 {
		for _, name := range missing {
			c.add(path, c.missingVarMsg(name))
		}
		return "", false
	}
	out, err = t.Execute(c.ctx)
	if err != nil {
		c.add(path, err.Error())
		return "", false
	}
	return out, true
}

func (c *checker) missingVarMsg(name string) string {
	if c.env == nil {
		return fmt.Sprintf("Variable %q is not set. Choose a server for this test that has it.", name)
	}
	envName := c.env.Name
	if len(c.availVars) == 0 {
		return fmt.Sprintf("Variable %q is not set on the server %s. It has no variables.", name, envName)
	}
	if len(c.availVars) <= 5 {
		return fmt.Sprintf("Variable %q is not set on the server %s. Available: %s.", name, envName, strings.Join(c.availVars, ", "))
	}
	return fmt.Sprintf("Variable %q is not set on the server %s.", name, envName)
}
