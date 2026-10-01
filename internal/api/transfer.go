package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/Gudboi-UwU/ndswarm/internal/auth"
	"github.com/Gudboi-UwU/ndswarm/internal/importer"
	"github.com/Gudboi-UwU/ndswarm/internal/model"
)

func (s *Server) transferRoutes(r chi.Router) {
	view, edit := require(auth.PermView), require(auth.PermEdit)
	r.With(view).Get("/tests/{id}/export", s.exportTest)
	r.With(view).Get("/projects/{id}/export", s.exportProject)
	r.With(edit).Post("/import/preview", s.importPreview)
	r.With(edit).Post("/import", s.importFile)
}

// ---- export (secret values are emptied by importer.FromProject)

func (s *Server) exportTest(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	ctx := r.Context()
	t, err := s.Projects.GetTest(ctx, id)
	if err != nil {
		fail(w, r, err)
		return
	}
	p, err := s.Projects.GetProject(ctx, t.ProjectID)
	if err != nil {
		fail(w, r, err)
		return
	}
	var envs []model.Environment
	if t.EnvironmentID != nil {
		if e, err := s.Projects.GetEnvironment(ctx, *t.EnvironmentID); err == nil {
			envs = append(envs, e)
		}
	}
	s.writeExport(w, r, importer.FromProject(p, envs, []model.Test{t}), t.Name, false)
}

func (s *Server) exportProject(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	ctx := r.Context()
	p, err := s.Projects.GetProject(ctx, id)
	if err != nil {
		fail(w, r, err)
		return
	}
	envs, err := s.Projects.ListEnvironments(ctx, id)
	if err != nil {
		fail(w, r, err)
		return
	}
	list, err := s.Projects.ListTests(ctx, id)
	if err != nil {
		fail(w, r, err)
		return
	}
	tests := make([]model.Test, 0, len(list))
	for i := len(list) - 1; i >= 0; i-- { // oldest first
		t, err := s.Projects.GetTest(ctx, list[i].ID)
		if err != nil {
			fail(w, r, err)
			return
		}
		tests = append(tests, t)
	}
	s.writeExport(w, r, importer.FromProject(p, envs, tests), p.Name, true)
}

func (s *Server) writeExport(w http.ResponseWriter, r *http.Request, b importer.Bundle, name string, folders bool) {
	q := r.URL.Query()
	format, typ := q.Get("format"), q.Get("type")
	var body []byte
	var err error
	var file, ctype string
	switch {
	case format == "postman":
		body, err = b.Postman(folders)
		file, ctype = slug(name)+".postman_collection.json", "application/json"
	case (format == "" || format == "ndswarm") && (typ == "" || typ == "json" || typ == "yaml"):
		if typ == "" {
			typ = "json"
		}
		body, err = b.Marshal(typ)
		file, ctype = slug(name)+".ndswarm."+typ, map[string]string{"json": "application/json", "yaml": "application/yaml"}[typ]
	default:
		writeError(w, http.StatusBadRequest, "bad_request", "format must be ndswarm or postman, and type json or yaml", nil)
		return
	}
	if err != nil {
		fail(w, r, err)
		return
	}
	w.Header().Set("Content-Type", ctype)
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, file))
	w.Write(body)
}

var nonSlug = regexp.MustCompile(`[^a-z0-9]+`)

// slug makes a safe file name: "Browse & checkout" -> "browse-checkout".
func slug(name string) string {
	s := strings.Trim(nonSlug.ReplaceAllString(strings.ToLower(name), "-"), "-")
	if s == "" {
		return "export"
	}
	return s
}

// ---- import

type importInput struct {
	Content     string `json:"content"`
	Environment string `json:"environment"`
	Split       string `json:"split"` // Postman only: "folder" (default) or "top"
	NewProject  string `json:"newProject"`
	ProjectID   int64  `json:"projectId"`
}

// readImport decodes an import body; files can be up to importer.MaxSize, so readJSON's limit is too small.
func readImport(w http.ResponseWriter, r *http.Request, preview bool) (importer.Bundle, []string, importInput, bool) {
	var in importInput
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 3*importer.MaxSize))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&in); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "Invalid JSON body: "+err.Error(), nil)
		return importer.Bundle{}, nil, in, false
	}
	if preview && (in.NewProject != "" || in.ProjectID != 0) {
		writeError(w, http.StatusBadRequest, "bad_request", "preview takes only content and environment", nil)
		return importer.Bundle{}, nil, in, false
	}
	if in.Split != "" && in.Split != "folder" && in.Split != "top" {
		writeError(w, http.StatusBadRequest, "bad_request", "split must be \"folder\" or \"top\"", nil)
		return importer.Bundle{}, nil, in, false
	}
	b, warns, err := importer.Decode(in.Content, in.Environment, in.Split)
	if err != nil {
		fail(w, r, model.ValidationError{{Path: "content", Message: sentence(err.Error())}})
		return b, nil, in, false
	}
	return b, warns, in, true
}

func (s *Server) importPreview(w http.ResponseWriter, r *http.Request) {
	b, warns, _, ok := readImport(w, r, true)
	if !ok {
		return
	}
	type reqOut struct {
		Method string `json:"method"`
		Name   string `json:"name"`
		URL    string `json:"url"`
	}
	type testOut struct {
		Name       string   `json:"name"`
		Folder     string   `json:"folder"`
		Server     string   `json:"server"`
		Requests   []reqOut `json:"requests"`
		Thresholds int      `json:"thresholds"`
	}
	type serverOut struct {
		Name      string `json:"name"`
		BaseURL   string `json:"baseUrl"`
		Variables int    `json:"variables"`
	}
	servers := []serverOut{}
	for _, sv := range b.Servers {
		servers = append(servers, serverOut{sv.Name, sv.BaseURL, len(sv.Variables)})
	}
	tests := []testOut{}
	for _, t := range b.Tests {
		out := testOut{Name: t.Name, Folder: t.Folder, Server: t.Server, Requests: []reqOut{}, Thresholds: len(t.Thresholds)}
		for _, f := range t.Flows {
			for _, st := range f.Steps {
				out.Requests = append(out.Requests, reqOut{st.Method, st.Name, st.URL})
			}
		}
		tests = append(tests, out)
	}
	if warns == nil {
		warns = []string{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"format": b.Format, "project": b.Project, "servers": servers, "tests": tests, "warnings": warns})
}

func (s *Server) importFile(w http.ResponseWriter, r *http.Request) {
	b, warns, in, ok := readImport(w, r, false)
	if !ok {
		return
	}
	res, err := importer.Save(r.Context(), s.Projects, b, in.ProjectID, in.NewProject)
	if err != nil {
		fail(w, r, err)
		return
	}
	res.Warnings = append(append([]string{}, warns...), res.Warnings...)
	writeJSON(w, http.StatusCreated, res)
}
