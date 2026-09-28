package api

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"github.com/Gudboi-UwU/ndswarm/internal/auth"
	"github.com/Gudboi-UwU/ndswarm/internal/runner"
)

func (s *Server) runRoutes(r chi.Router) {
	view, run := require(auth.PermView), require(auth.PermRun)
	r.With(view).Get("/ws", s.Hub.serve)
	r.With(run).Post("/tests/{id}/preflight", s.preflight)
	r.With(run).Post("/tests/{id}/runs", s.startRun)
	r.With(view).Get("/runs", s.listRuns)
	r.With(view).Get("/runs/active", s.activeRun)
	r.With(view).Get("/runs/{id}", s.getRun)
	r.With(view).Get("/runs/{id}/timeseries", s.timeseries)
	r.With(run).Post("/runs/{id}/stop", s.stopRun)
}

func (s *Server) preflight(w http.ResponseWriter, r *http.Request) {
	if id, ok := pathID(w, r); ok {
		respond(w, r, http.StatusOK)(s.Runner.Preflight(r.Context(), id))
	}
}

func (s *Server) startRun(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	var in struct {
		Force bool `json:"force"`
	}
	if !ok || !readJSON(w, r, &in) {
		return
	}
	who := "guest"
	if u := principalFrom(r.Context()).User; u != nil {
		who = u.Username
	}
	runID, err := s.Runner.Start(r.Context(), id, who, in.Force)
	var active runner.ActiveError
	var pf runner.PreflightError
	switch {
	case errors.As(err, &active):
		writeJSON(w, http.StatusConflict, map[string]any{
			"error": map[string]string{"code": "run_active", "message": "A test is already running."},
			"runId": active.RunID,
		})
	case errors.As(err, &pf):
		writeJSON(w, http.StatusUnprocessableEntity, map[string]any{
			"error":     map[string]string{"code": "preflight", "message": "Preflight found problems."},
			"preflight": pf.Result,
		})
	case err != nil:
		fail(w, r, err)
	default:
		writeJSON(w, http.StatusCreated, map[string]int64{"id": runID})
	}
}

func (s *Server) listRuns(w http.ResponseWriter, r *http.Request) {
	testID, _ := strconv.ParseInt(r.URL.Query().Get("testId"), 10, 64)
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	respond(w, r, http.StatusOK)(s.Runner.List(r.Context(), testID, limit))
}

func (s *Server) activeRun(w http.ResponseWriter, _ *http.Request) {
	var id any
	if a := s.Runner.ActiveID(); a > 0 {
		id = a
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": id})
}

func (s *Server) getRun(w http.ResponseWriter, r *http.Request) {
	if id, ok := pathID(w, r); ok {
		respond(w, r, http.StatusOK)(s.Runner.Get(r.Context(), id))
	}
}

func (s *Server) timeseries(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	key := -1
	if k := r.URL.Query().Get("key"); k != "" {
		var err error
		if key, err = strconv.Atoi(k); err != nil {
			writeError(w, http.StatusBadRequest, "bad_request", "key must be a number", nil)
			return
		}
	}
	respond(w, r, http.StatusOK)(s.Runner.Timeseries(r.Context(), id, key))
}

func (s *Server) stopRun(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	who := "guest"
	if u := principalFrom(r.Context()).User; u != nil {
		who = u.Username
	}
	if err := s.Runner.Stop(r.Context(), id, "stopped by "+who); err != nil {
		fail(w, r, err)
		return
	}
	w.WriteHeader(http.StatusAccepted)
}
