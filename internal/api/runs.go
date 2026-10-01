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
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	pf, err := s.Runner.Preflight(r.Context(), id)
	var chk runner.CheckError
	if errors.As(err, &chk) {
		writeCheckFailed(w, chk)
		return
	}
	respond(w, r, http.StatusOK)(pf, err)
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
	var chk runner.CheckError
	switch {
	case errors.As(err, &active):
		writeJSON(w, http.StatusConflict, map[string]any{
			"error": map[string]string{"code": "run_active", "message": "A test is already running."},
			"runId": active.RunID,
		})
	case errors.As(err, &chk):
		writeCheckFailed(w, chk)
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

// writeCheckFailed refuses a run whose templates have problems. Unlike a preflight warning there
// is no "run anyway", so it is a plain 400 with the same shape as POST /tests/check.
func writeCheckFailed(w http.ResponseWriter, chk runner.CheckError) {
	writeJSON(w, http.StatusBadRequest, map[string]any{
		"error":    map[string]string{"code": "check_failed", "message": "This test cannot run until these problems are fixed."},
		"problems": nonNilProblems(chk.Problems),
	})
}

func (s *Server) listRuns(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	f := runner.RunFilter{Status: q.Get("status"), Result: q.Get("result")}
	f.TestID, _ = strconv.ParseInt(q.Get("testId"), 10, 64)
	f.ProjectID, _ = strconv.ParseInt(q.Get("projectId"), 10, 64)
	f.Before, _ = strconv.ParseInt(q.Get("before"), 10, 64)
	f.Limit, _ = strconv.Atoi(q.Get("limit"))
	respond(w, r, http.StatusOK)(s.Runner.List(r.Context(), f))
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
