package runner

import (
	"context"
	"errors"
	"fmt"

	"github.com/Gudboi-UwU/ndswarm/internal/engine"
	"github.com/Gudboi-UwU/ndswarm/internal/model"
	"github.com/Gudboi-UwU/ndswarm/internal/store"
)

// Preflight is what the UI shows before a start. Errors block; warnings need "Start anyway".
type Preflight struct {
	Errors   []string       `json:"errors"`
	Warnings []string       `json:"warnings"`
	Checks   []engine.Check `json:"checks"`
}

const renderRounds = 20

// Preflight checks a test without starting it.
func (r *Runner) Preflight(ctx context.Context, testID int64) (Preflight, error) {
	pf, _, _, _, err := r.preflight(ctx, testID)
	return pf, err
}

func (r *Runner) preflight(ctx context.Context, testID int64) (Preflight, *engine.Plan, model.Test, *model.Environment, error) {
	pf := Preflight{Errors: []string{}, Warnings: []string{}, Checks: []engine.Check{}}
	t, err := r.projects.GetTest(ctx, testID)
	if err != nil {
		return pf, nil, t, nil, err
	}
	var env *model.Environment
	if t.EnvironmentID != nil {
		e, err := r.projects.GetEnvironment(ctx, *t.EnvironmentID)
		if err != nil {
			return pf, nil, t, nil, err
		}
		env = &e
	}

	if err := t.Validate(); err != nil {
		var v model.ValidationError
		if errors.As(err, &v) {
			for _, fe := range v {
				pf.Errors = append(pf.Errors, fmt.Sprintf("%s: %s", fe.Path, fe.Message))
			}
			return pf, nil, t, env, nil
		}
		return pf, nil, t, env, err
	}
	sc, red, err := engine.SampleCtx(env)
	if err != nil {
		pf.Errors = append(pf.Errors, "Environment "+err.Error())
		return pf, nil, t, env, nil
	}
	if problems := engine.CheckTest(t, env, sc, red); len(problems) > 0 {
		return pf, nil, t, env, CheckError{problems}
	}
	plan, err := engine.NewPlan(t, env)
	if err != nil {
		pf.Errors = append(pf.Errors, err.Error())
		return pf, nil, t, env, nil
	}
	guard, err := Guard(ctx, r.db)
	if err != nil {
		return pf, nil, t, env, err
	}
	plan.Guard = guard
	if pf.Errors = append(pf.Errors, plan.RenderCheck(renderRounds)...); len(pf.Errors) > 0 {
		return pf, plan, t, env, nil
	}
	pf.Checks = plan.SendCheck(ctx)
	for _, c := range pf.Checks {
		if c.Error != "" {
			pf.Warnings = append(pf.Warnings, fmt.Sprintf("%s: %s", c.Name, c.Error))
		}
	}
	return pf, plan, t, env, nil
}

// Guard reads the admin's target limits for requests.
func Guard(ctx context.Context, db *store.Store) (engine.Guard, error) {
	ss, err := db.ServerSettings(ctx)
	return engine.Guard{AllowLinkLocal: ss.AllowLinkLocal, Allow: ss.TargetAllowlist}, err
}
