package project

import (
	"context"

	"github.com/Gudboi-UwU/ndswarm/internal/model"
)

const demoSetting = "demo_seeded"

// SeedDemo creates a demo project against the dummy target once, on an empty server.
// It never runs again after the first seed, even if the demo is deleted.
func (s *Service) SeedDemo(ctx context.Context, target string) (bool, error) {
	if done, err := s.db.Setting(ctx, demoSetting, ""); err != nil || done != "" {
		return false, err
	}
	projects, err := s.ListProjects(ctx)
	if err != nil {
		return false, err
	}
	if len(projects) > 0 {
		return false, s.db.SetSetting(ctx, demoSetting, "skipped")
	}

	p, err := s.CreateProject(ctx, model.Project{Name: "Demo shop", Description: "A ready-made test against the bundled dummy target. Press Start to see live results."})
	if err != nil {
		return false, err
	}
	env, err := s.CreateEnvironment(ctx, model.Environment{
		ProjectID: p.ID, Name: "dummy target", BaseURL: target,
		Variables: []model.EnvVar{{Key: "user", Value: "demo"}, {Key: "password", Value: "demo", Secret: true}},
		Headers:   []model.EnvVar{{Key: "Accept", Value: "application/json"}},
	})
	if err != nil {
		return false, err
	}
	yes := true
	get := func(id, name, url string, weight int) model.Flow {
		return model.Flow{ID: id, Name: name, Enabled: true, Weight: weight, Steps: []model.Step{{
			ID: id, Name: name, Enabled: true, Method: "GET", URL: url, FollowRedirects: true, Body: model.Body{Type: "none"},
		}}}
	}
	login := get("login", "Login", "/login", 1)
	login.Steps[0].Method = "POST"
	login.Steps[0].Body = model.Body{Type: "json", Variants: []model.Variant{{
		ID: "demo", Name: "demo user", Weight: 1, Enabled: true, Mode: "fields",
		Fields: []model.Field{{Key: "username", Type: "string", Value: `{{var "user"}}`}, {Key: "password", Type: "string", Value: `{{var "password"}}`}},
	}}}
	order := get("order", "Create order", "/echo", 2)
	order.Steps[0].Method = "POST"
	order.Steps[0].Body = model.Body{Type: "json", VariantPick: "weighted", Variants: []model.Variant{
		{ID: "small", Name: "small order", Weight: 3, Enabled: true, Mode: "fields", Fields: []model.Field{
			{Key: "orderId", Type: "string", Value: "{{uuid}}"},
			{Key: "customer", Type: "object", Children: []model.Field{
				{Key: "name", Type: "string", Value: "{{name}}"}, {Key: "email", Type: "string", Value: "{{email}}"}}},
			{Key: "items", Type: "array", ArrayLen: &model.MinMax{Min: 1, Max: 3}, Children: []model.Field{{Type: "object", Children: []model.Field{
				{Key: "sku", Type: "string", Value: `{{regex "[A-Z]{3}-[0-9]{4}"}}`},
				{Key: "qty", Type: "integer", Value: "{{int 1 5}}"},
				{Key: "price", Type: "number", Value: "{{float 1 250 2}}"}}}}},
			{Key: "gift", Type: "boolean", Value: "{{bool 0.1}}", Enabled: &yes},
		}},
		{ID: "raw", Name: "raw JSON", Weight: 1, Enabled: true, Mode: "raw",
			Raw: "{\n  \"orderId\": {{q (uuid)}},\n  \"note\": {{q (sentence 5)}},\n  \"total\": {{float 10 900 2}}\n}"},
	}}

	_, err = s.CreateTest(ctx, model.Test{
		ProjectID: p.ID, Name: "Browse and checkout", EnvironmentID: &env.ID,
		Description: "Five endpoints: fast and slow reads, a flaky one, login and order creation with two body variants.",
		Flows: []model.Flow{
			get("fast", "Home", "/fast", 4),
			get("slow", "Search", "/slow?ms={{int 20 80}}", 2),
			get("flaky", "Recommendations", "/flaky?err=0.05", 2),
			login, order,
		},
		Load:     model.Load{Stages: []model.Stage{{DurationSec: 5, Target: 10}, {DurationSec: 25, Target: 10}}, MaxVUs: 10, GracefulStopSec: 5},
		Settings: model.DefaultSettings,
	})
	if err != nil {
		return false, err
	}
	return true, s.db.SetSetting(ctx, demoSetting, "done")
}
