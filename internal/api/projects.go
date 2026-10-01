package api

import (
	"context"
	"net/http"
	"time"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"

	"github.com/Gudboi-UwU/ndswarm/internal/auth"
	"github.com/Gudboi-UwU/ndswarm/internal/engine"
	"github.com/Gudboi-UwU/ndswarm/internal/model"
	"github.com/Gudboi-UwU/ndswarm/internal/runner"
	"github.com/Gudboi-UwU/ndswarm/internal/tmpl"
)

func (s *Server) projectRoutes(r chi.Router) {
	view, edit := require(auth.PermView), require(auth.PermEdit)

	r.With(view).Get("/projects", s.listProjects)
	r.With(edit).Post("/projects", s.createProject)
	r.With(view).Get("/projects/{id}", s.getProject)
	r.With(edit).Patch("/projects/{id}", s.updateProject)
	r.With(edit).Delete("/projects/{id}", s.deleteProject)

	r.With(view).Get("/projects/{id}/environments", s.listEnvironments)
	r.With(edit).Post("/projects/{id}/environments", s.createEnvironment)
	r.With(view).Get("/environments/{id}", s.getEnvironment)
	r.With(edit).Put("/environments/{id}", s.updateEnvironment)
	r.With(edit).Delete("/environments/{id}", s.deleteEnvironment)

	r.With(view).Get("/tests", s.listAllTests)
	r.With(view).Get("/projects/{id}/tests", s.listTests)
	r.With(edit).Post("/projects/{id}/tests", s.createTest)
	r.With(edit).Post("/projects/{id}/folders/rename", s.renameFolder)
	r.With(view).Get("/tests/{id}", s.getTest)
	r.With(edit).Put("/tests/{id}", s.updateTest)
	r.With(edit).Delete("/tests/{id}", s.deleteTest)
	r.With(edit).Post("/tests/{id}/duplicate", s.duplicateTest)
	r.With(edit).Post("/tests/{id}/folder", s.moveTest)

	r.With(view).Get("/tools/generators", s.generators)
	r.With(edit).Post("/tools/render", s.render)
	r.With(edit).Post("/tools/try", s.try)
	r.With(edit).Post("/tests/check", s.checkTest)
}

// ---- projects

func (s *Server) listProjects(w http.ResponseWriter, r *http.Request) {
	respond(w, r, http.StatusOK)(s.Projects.ListProjects(r.Context()))
}

func (s *Server) getProject(w http.ResponseWriter, r *http.Request) {
	if id, ok := pathID(w, r); ok {
		respond(w, r, http.StatusOK)(s.Projects.GetProject(r.Context(), id))
	}
}

func (s *Server) createProject(w http.ResponseWriter, r *http.Request) {
	var in model.Project
	if readJSON(w, r, &in) {
		respond(w, r, http.StatusCreated)(s.Projects.CreateProject(r.Context(), in))
	}
}

func (s *Server) updateProject(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	var in model.Project
	if ok && readJSON(w, r, &in) {
		in.ID = id
		respond(w, r, http.StatusOK)(s.Projects.UpdateProject(r.Context(), in))
	}
}

func (s *Server) deleteProject(w http.ResponseWriter, r *http.Request) {
	if id, ok := pathID(w, r); ok {
		noContent(w, r, s.Projects.DeleteProject(r.Context(), id))
	}
}

// ---- environments (secret values never leave the server)

func (s *Server) listEnvironments(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	envs, err := s.Projects.ListEnvironments(r.Context(), id)
	for i := range envs {
		envs[i].Mask()
	}
	respond(w, r, http.StatusOK)(envs, err)
}

func (s *Server) getEnvironment(w http.ResponseWriter, r *http.Request) {
	if id, ok := pathID(w, r); ok {
		e, err := s.Projects.GetEnvironment(r.Context(), id)
		e.Mask()
		respond(w, r, http.StatusOK)(e, err)
	}
}

func (s *Server) createEnvironment(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	var in model.Environment
	if ok && readJSON(w, r, &in) {
		in.ProjectID = id
		e, err := s.Projects.CreateEnvironment(r.Context(), in)
		e.Mask()
		respond(w, r, http.StatusCreated)(e, err)
	}
}

func (s *Server) updateEnvironment(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	var in model.Environment
	if ok && readJSON(w, r, &in) {
		in.ID = id
		e, err := s.Projects.UpdateEnvironment(r.Context(), in)
		e.Mask()
		respond(w, r, http.StatusOK)(e, err)
	}
}

func (s *Server) deleteEnvironment(w http.ResponseWriter, r *http.Request) {
	if id, ok := pathID(w, r); ok {
		noContent(w, r, s.Projects.DeleteEnvironment(r.Context(), id))
	}
}

// ---- tests

func (s *Server) listTests(w http.ResponseWriter, r *http.Request) {
	if id, ok := pathID(w, r); ok {
		respond(w, r, http.StatusOK)(s.Projects.ListTests(r.Context(), id))
	}
}

func (s *Server) listAllTests(w http.ResponseWriter, r *http.Request) {
	respond(w, r, http.StatusOK)(s.Projects.ListAllTests(r.Context()))
}

func (s *Server) getTest(w http.ResponseWriter, r *http.Request) {
	if id, ok := pathID(w, r); ok {
		respond(w, r, http.StatusOK)(s.Projects.GetTest(r.Context(), id))
	}
}

func (s *Server) createTest(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	in := model.Test{Settings: model.DefaultSettings} // fields the client omits keep their defaults
	if ok && readJSON(w, r, &in) {
		in.ProjectID = id
		respond(w, r, http.StatusCreated)(s.Projects.CreateTest(r.Context(), in))
	}
}

func (s *Server) updateTest(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	var in model.Test
	if ok && readJSON(w, r, &in) {
		in.ID = id
		respond(w, r, http.StatusOK)(s.Projects.UpdateTest(r.Context(), in))
	}
}

func (s *Server) deleteTest(w http.ResponseWriter, r *http.Request) {
	if id, ok := pathID(w, r); ok {
		noContent(w, r, s.Projects.DeleteTest(r.Context(), id))
	}
}

func (s *Server) duplicateTest(w http.ResponseWriter, r *http.Request) {
	if id, ok := pathID(w, r); ok {
		respond(w, r, http.StatusCreated)(s.Projects.DuplicateTest(r.Context(), id))
	}
}

func (s *Server) moveTest(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	var in struct {
		Folder string `json:"folder"`
	}
	if ok && readJSON(w, r, &in) {
		respond(w, r, http.StatusOK)(s.Projects.MoveTest(r.Context(), id, in.Folder))
	}
}

func (s *Server) renameFolder(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	var in struct {
		From string `json:"from"`
		To   string `json:"to"`
	}
	if ok && readJSON(w, r, &in) {
		noContent(w, r, s.Projects.RenameFolder(r.Context(), id, in.From, in.To))
	}
}

// ---- tools

func (s *Server) generators(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, tmpl.Catalog)
}

// toolEnv loads the environment for a tool call and prepares a render context with its variables.
func (s *Server) toolEnv(ctx context.Context, envID *int64) (*model.Environment, *tmpl.Ctx, engine.Redactor, error) {
	if envID == nil {
		c, red, _ := engine.SampleCtx(nil)
		return nil, c, red, nil
	}
	e, err := s.Projects.GetEnvironment(ctx, *envID)
	if err != nil {
		return nil, nil, engine.Redactor{}, model.ValidationError{{Path: "environmentId", Message: "That environment no longer exists."}}
	}
	c, red, err := engine.SampleCtx(&e)
	if err != nil {
		return nil, nil, engine.Redactor{}, model.ValidationError{{Path: "environmentId", Message: err.Error()}}
	}
	return &e, c, red, nil
}

// render previews a template: five samples, or the error a user would hit at run time.
func (s *Server) render(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Template      string `json:"template"`
		Type          string `json:"type"` // optional field type to check conversion
		EnvironmentID *int64 `json:"environmentId"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	t, err := tmpl.Compile(in.Template)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"samples": []string{}, "error": err.Error()})
		return
	}
	_, c, red, err := s.toolEnv(r.Context(), in.EnvironmentID)
	if err != nil {
		fail(w, r, err)
		return
	}
	samples := []string{}
	for range 5 {
		out, err := t.Execute(c)
		if err == nil && in.Type != "" && in.Type != "string" {
			_, err = engine.Typed("value", in.Type, out)
		}
		if err != nil {
			writeJSON(w, http.StatusOK, map[string]any{"samples": samples, "error": red.String(err.Error())})
			return
		}
		samples = append(samples, red.String(out))
	}
	writeJSON(w, http.StatusOK, map[string]any{"samples": samples, "error": nil})
}

const maxShownBody = 64 << 10

// try sends one step once and returns what was sent and received.
func (s *Server) try(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Step          model.Step `json:"step"`
		EnvironmentID *int64     `json:"environmentId"`
		Variant       int        `json:"variant"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	model.NormalizeStep(&in.Step)
	if err := model.ValidateStep(in.Step); err != nil {
		fail(w, r, err)
		return
	}
	env, c, red, err := s.toolEnv(r.Context(), in.EnvironmentID)
	if err != nil {
		fail(w, r, err)
		return
	}
	step, err := engine.Compile(in.Step, env)
	if err != nil {
		fail(w, r, model.ValidationError{{Path: "step", Message: err.Error()}})
		return
	}
	req, err := step.Render(c, max(in.Variant, 0))
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"error": map[string]string{"category": "template", "message": red.String(err.Error())}})
		return
	}

	guard, err := runner.Guard(r.Context(), s.Store)
	if err != nil {
		fail(w, r, err)
		return
	}
	transport := engine.NewTransport(engine.ClientOptions{HTTP2: true, Guard: guard})
	defer transport.CloseIdleConnections()
	res := engine.Send(r.Context(), engine.Client(transport, in.Step.FollowRedirects), req, time.Duration(in.Step.TimeoutMs)*time.Millisecond)

	out := map[string]any{
		"request": map[string]any{
			"method":  req.Method,
			"url":     red.String(req.URL),
			"headers": red.Header(req.Header),
			"body":    red.String(shownBody(req.Body)),
			"variant": req.Variant,
		},
		"timing": res.Timing,
		"error":  nil,
	}
	if res.Err != nil {
		out["error"] = map[string]string{"category": res.Category, "message": red.String(res.Err.Error())}
	}
	if res.Status != 0 {
		out["response"] = map[string]any{
			"status":     res.Status,
			"statusText": http.StatusText(res.Status),
			"headers":    red.Header(res.Header),
			"body":       red.String(shownBody(res.Body)),
			"size":       res.BytesIn,
			"truncated":  len(res.Body) > maxShownBody || int64(len(res.Body)) < res.BytesIn,
		}
	}
	writeJSON(w, http.StatusOK, out)
}

// checkTest finds template problems in a test draft (parse errors, unset variables, values that
// would not render or fit their type) without sending any HTTP requests. Used by the builder to
// mark broken inputs red as the user types.
func (s *Server) checkTest(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Test          model.Test `json:"test"`
		EnvironmentID *int64     `json:"environmentId"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	in.Test.Normalize()
	env, c, red, err := s.toolEnv(r.Context(), in.EnvironmentID)
	if err != nil {
		fail(w, r, err)
		return
	}
	problems := engine.CheckTest(in.Test, env, c, red)
	writeJSON(w, http.StatusOK, nonNilProblems(problems))
}

// nonNilProblems makes JSON show [] instead of null for an empty result.
func nonNilProblems(p []model.FieldError) []model.FieldError {
	if p == nil {
		return []model.FieldError{}
	}
	return p
}

func shownBody(b []byte) string {
	if len(b) > maxShownBody {
		b = b[:maxShownBody]
	}
	if !utf8.Valid(b) {
		// A cut can split one multi-byte rune; only call it binary when more is wrong.
		trimmed := b
		for i := 0; i < 3 && len(trimmed) > 0 && !utf8.Valid(trimmed); i++ {
			trimmed = trimmed[:len(trimmed)-1]
		}
		if !utf8.Valid(trimmed) {
			return "[binary body]"
		}
		b = trimmed
	}
	return string(b)
}

// respond writes v with status, or maps err. Use as respond(w, r, 200)(service call).
func respond(w http.ResponseWriter, r *http.Request, status int) func(any, error) {
	return func(v any, err error) {
		if err != nil {
			fail(w, r, err)
			return
		}
		writeJSON(w, status, v)
	}
}

func noContent(w http.ResponseWriter, r *http.Request, err error) {
	if err != nil {
		fail(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
