// Package api wires the HTTP surface: health probes, /api/v1 and the embedded SPA.
package api

import (
	"encoding/json"
	"errors"
	"io/fs"
	"log/slog"
	"net/http"
	"path"
	"runtime"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"github.com/Gudboi-UwU/ndswarm/internal/auth"
	"github.com/Gudboi-UwU/ndswarm/internal/model"
	"github.com/Gudboi-UwU/ndswarm/internal/project"
	"github.com/Gudboi-UwU/ndswarm/internal/runner"
	"github.com/Gudboi-UwU/ndswarm/internal/store"
)

type Server struct {
	Auth     *auth.Service
	Projects *project.Service
	Runner   *runner.Runner
	Hub      *Hub
	Store    *store.Store
	UI       fs.FS // built SPA: index.html + assets/
	Version  string
	started  time.Time
}

func (s *Server) Handler() http.Handler {
	s.started = time.Now()
	r := chi.NewRouter()
	r.Use(middleware.Recoverer)

	r.Get("/healthz", func(w http.ResponseWriter, _ *http.Request) { w.Write([]byte("ok")) })
	r.Get("/readyz", func(w http.ResponseWriter, r *http.Request) {
		if err := s.Store.R.PingContext(r.Context()); err != nil {
			http.Error(w, "database unavailable", http.StatusServiceUnavailable)
			return
		}
		w.Write([]byte("ok"))
	})

	r.Route("/api/v1", func(r chi.Router) {
		r.Use(csrf, s.principal)

		r.Post("/auth/setup", s.setup)
		r.Post("/auth/login", s.login)
		r.Post("/auth/logout", s.logout)
		r.Get("/auth/me", s.me)

		r.With(require(auth.PermView)).Get("/system", s.system)
		s.projectRoutes(r)
		s.runRoutes(r)
		s.insightRoutes(r)

		r.Group(func(r chi.Router) {
			r.Use(require(auth.PermAdmin))
			r.Get("/users", s.listUsers)
			r.Post("/users", s.createUser)
			r.Patch("/users/{id}", s.updateUser)
			r.Delete("/users/{id}", s.deleteUser)
			r.Get("/settings", s.getSettings)
			r.Patch("/settings", s.patchSettings)
		})

		r.NotFound(func(w http.ResponseWriter, _ *http.Request) {
			writeError(w, http.StatusNotFound, "not_found", "unknown API route", nil)
		})
		r.MethodNotAllowed(func(w http.ResponseWriter, _ *http.Request) {
			writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed", nil)
		})
	})

	r.NotFound(spa(s.UI))
	return r
}

func (s *Server) system(w http.ResponseWriter, _ *http.Request) {
	var m runtime.MemStats
	runtime.ReadMemStats(&m)
	writeJSON(w, http.StatusOK, map[string]any{
		"version":    s.Version,
		"goVersion":  runtime.Version(),
		"cpus":       runtime.NumCPU(),
		"goroutines": runtime.NumGoroutine(),
		"memMB":      m.Sys >> 20,
		"uptimeSec":  int(time.Since(s.started).Seconds()),
	})
}

// spa serves real files from ui and falls back to index.html for client-side routes.
func spa(ui fs.FS) http.HandlerFunc {
	files := http.FileServerFS(ui)
	return func(w http.ResponseWriter, r *http.Request) {
		name := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
		if name != "" {
			if st, err := fs.Stat(ui, name); err == nil && !st.IsDir() {
				if strings.HasPrefix(name, "assets/") {
					w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
				}
				files.ServeHTTP(w, r)
				return
			}
		}
		index, err := fs.ReadFile(ui, "index.html")
		if err != nil {
			http.Error(w, "UI not built. Run `make build`.", http.StatusServiceUnavailable)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Cache-Control", "no-cache")
		w.Write(index)
	}
}

// readJSON decodes a JSON body strictly (unknown fields are an error, so typos surface).
func readJSON(w http.ResponseWriter, r *http.Request, v any) bool {
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "Invalid JSON body: "+err.Error(), nil)
		return false
	}
	return true
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, code, msg string, details model.ValidationError) {
	e := map[string]any{"code": code, "message": msg}
	if len(details) > 0 {
		e["details"] = details
	}
	writeJSON(w, status, map[string]any{"error": e})
}

// fail maps domain errors to HTTP responses; anything unknown is logged and hidden as 500.
func fail(w http.ResponseWriter, r *http.Request, err error) {
	msg := sentence(err.Error())
	var v model.ValidationError
	switch {
	case errors.As(err, &v):
		writeError(w, http.StatusBadRequest, "validation", "some fields are invalid", v)
	case errors.Is(err, auth.ErrInvalidCredentials):
		writeError(w, http.StatusUnauthorized, "invalid_credentials", msg, nil)
	case errors.Is(err, auth.ErrRateLimited):
		writeError(w, http.StatusTooManyRequests, "rate_limited", msg, nil)
	case errors.Is(err, auth.ErrUsernameTaken):
		writeError(w, http.StatusConflict, "conflict", msg, model.ValidationError{{Path: "username", Message: msg}})
	case errors.Is(err, auth.ErrNotFound), errors.Is(err, project.ErrNotFound), errors.Is(err, runner.ErrNotFound):
		writeError(w, http.StatusNotFound, "not_found", msg, nil)
	case errors.Is(err, auth.ErrSetupDone), errors.Is(err, auth.ErrLastAdmin), errors.Is(err, auth.ErrSelfDelete), errors.Is(err, runner.ErrNotActive), errors.Is(err, runner.ErrStillRunning):
		writeError(w, http.StatusConflict, "conflict", msg, nil)
	default:
		slog.Error("request failed", "method", r.Method, "path", r.URL.Path, "err", err)
		writeError(w, http.StatusInternalServerError, "internal", "internal server error", nil)
	}
}

// sentence turns a Go error string ("username already exists") into UI text ("Username already exists.").
func sentence(s string) string {
	if s == "" {
		return s
	}
	return strings.ToUpper(s[:1]) + s[1:] + "."
}
