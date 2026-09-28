package api

import (
	"encoding/csv"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"github.com/Gudboi-UwU/ndswarm/internal/auth"
	"github.com/Gudboi-UwU/ndswarm/internal/engine"
	"github.com/Gudboi-UwU/ndswarm/internal/metrics"
	"github.com/Gudboi-UwU/ndswarm/internal/runner"
)

func (s *Server) insightRoutes(r chi.Router) {
	view, edit := require(auth.PermView), require(auth.PermEdit)
	r.With(view).Get("/runs/{id}/logs", s.logs)
	r.With(view).Get("/runs/{id}/logs/{logId}", s.logDetail)
	r.With(view).Get("/runs/{id}/errors", s.errorsView)
	r.With(view).Get("/runs/{id}/summary", s.summary)
	r.With(view).Get("/runs/{id}/export", s.export)
	r.With(edit).Delete("/runs/{id}", s.deleteRun)
	r.With(view).Get("/dashboard", s.dashboard)
}

func (s *Server) logs(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	q := r.URL.Query()
	f := runner.LogFilter{Category: q.Get("category"), Reason: q.Get("reason")}
	f.Status, _ = strconv.Atoi(q.Get("status"))
	f.MinMs, _ = strconv.ParseFloat(q.Get("minMs"), 64)
	f.VU, _ = strconv.Atoi(q.Get("vu"))
	f.After, _ = strconv.ParseInt(q.Get("cursor"), 10, 64)
	f.Limit, _ = strconv.Atoi(q.Get("limit"))
	if k, err := strconv.Atoi(q.Get("key")); err == nil {
		f.Key = &k
	}
	if v, err := strconv.ParseInt(q.Get("from"), 10, 64); err == nil {
		f.FromSec = &v
	}
	if v, err := strconv.ParseInt(q.Get("to"), 10, 64); err == nil {
		f.ToSec = &v
	}
	respond(w, r, http.StatusOK)(s.Runner.Logs(r.Context(), id, f))
}

func (s *Server) logDetail(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	logID, err := strconv.ParseInt(chi.URLParam(r, "logId"), 10, 64)
	if !ok {
		return
	}
	if err != nil {
		writeError(w, http.StatusNotFound, "not_found", "no such log", nil)
		return
	}
	respond(w, r, http.StatusOK)(s.Runner.Log(r.Context(), id, logID))
}

func (s *Server) errorsView(w http.ResponseWriter, r *http.Request) {
	if id, ok := pathID(w, r); ok {
		respond(w, r, http.StatusOK)(s.Runner.Errors(r.Context(), id))
	}
}

// summary?by=interval&interval=10|60 or summary?by=status
func (s *Server) summary(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	switch r.URL.Query().Get("by") {
	case "status":
		respond(w, r, http.StatusOK)(s.Runner.Statuses(r.Context(), id))
	case "interval", "":
		size, _ := strconv.Atoi(r.URL.Query().Get("interval"))
		if size != 10 && size != 60 {
			size = 10
		}
		respond(w, r, http.StatusOK)(s.Runner.Intervals(r.Context(), id, size))
	default:
		writeError(w, http.StatusBadRequest, "bad_request", "by must be interval or status", nil)
	}
}

func (s *Server) deleteRun(w http.ResponseWriter, r *http.Request) {
	if id, ok := pathID(w, r); ok {
		noContent(w, r, s.Runner.Delete(r.Context(), id))
	}
}

func (s *Server) dashboard(w http.ResponseWriter, r *http.Request) {
	respond(w, r, http.StatusOK)(s.Runner.Dashboard(r.Context()))
}

const maxExportLogs = 100_000

// export?what=summary|timeseries|logs&format=csv|json downloads a file.
func (s *Server) export(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	what, format := r.URL.Query().Get("what"), r.URL.Query().Get("format")
	if format != "json" {
		format = "csv"
	}
	run, err := s.Runner.Get(r.Context(), id)
	if err != nil {
		fail(w, r, err)
		return
	}
	labels := map[int]string{-1: "All"}
	for _, k := range run.Keys {
		labels[k.ID] = keyName(k)
	}

	var header []string
	var rows [][]string
	var data any
	switch what {
	case "summary", "":
		what = "summary"
		header = []string{"endpoint", "requests", "ok", "errors", "error_pct", "avg_ms", "min_ms", "max_ms", "p50_ms", "p90_ms", "p95_ms", "p99_ms", "rps", "bytes_in", "bytes_out"}
		out := []map[string]any{}
		if run.Summary != nil {
			stats := []metrics.KeyStats{{Key: -1, Total: run.Summary.Total}}
			stats = append(stats, run.Summary.Keys...)
			for _, ks := range stats {
				st := ks.Total
				errPct := 0.0
				if st.Count > 0 {
					errPct = float64(st.Err) / float64(st.Count) * 100
				}
				out = append(out, map[string]any{"endpoint": labels[ks.Key], "stats": st, "errorPct": errPct})
				rows = append(rows, []string{labels[ks.Key], itoa(st.Count), itoa(st.OK), itoa(st.Err), ftoa(errPct), ftoa(st.Avg), ftoa(st.Min), ftoa(st.Max),
					ftoa(st.P50), ftoa(st.P90), ftoa(st.P95), ftoa(st.P99), ftoa(st.RPS), itoa(st.BytesIn), itoa(st.BytesOut)})
			}
		}
		data = out
	case "timeseries":
		secs, err := s.Runner.Seconds(r.Context(), id)
		if err != nil {
			fail(w, r, err)
			return
		}
		header = []string{"second", "endpoint", "requests", "ok", "errors", "avg_ms", "min_ms", "max_ms", "p50_ms", "p90_ms", "p95_ms", "p99_ms", "vus", "bytes_in", "bytes_out"}
		for _, x := range secs {
			rows = append(rows, []string{itoa(x.T), labels[x.Key], itoa(x.Count), itoa(x.OK), itoa(x.Err), ftoa(x.Avg), ftoa(x.Min), ftoa(x.Max),
				ftoa(x.P50), ftoa(x.P90), ftoa(x.P95), ftoa(x.P99), strconv.Itoa(x.VUs), itoa(x.BytesIn), itoa(x.BytesOut)})
		}
		data = secs
	case "logs":
		var all []runner.LogRow
		for after := int64(0); len(all) < maxExportLogs; {
			page, err := s.Runner.Logs(r.Context(), id, runner.LogFilter{After: after, Limit: 500})
			if err != nil {
				fail(w, r, err)
				return
			}
			all = append(all, page.Items...)
			if page.Next == nil {
				break
			}
			after = *page.Next
		}
		header = []string{"id", "time_ms", "second", "vu", "iteration", "endpoint", "status", "category", "latency_ms", "reason", "error"}
		for _, l := range all {
			rows = append(rows, []string{itoa(l.ID), itoa(l.TMs), itoa(l.Sec), strconv.Itoa(l.VU), itoa(l.Iter), labels[l.Key], strconv.Itoa(l.Status), l.Category, ftoa(l.LatencyMs), l.Reason, l.Error})
		}
		data = all
	default:
		writeError(w, http.StatusBadRequest, "bad_request", "what must be summary, timeseries or logs", nil)
		return
	}

	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="run-%d-%s.%s"`, id, what, format))
	if format == "json" {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(data)
		return
	}
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	cw := csv.NewWriter(w)
	cw.Write(header)
	cw.WriteAll(rows)
}

func keyName(k engine.Key) string {
	s := k.Flow
	if k.Step != k.Flow {
		s += " / " + k.Step
	}
	if k.Variant != "" {
		s += " [" + k.Variant + "]"
	}
	return s
}

func itoa(n int64) string   { return strconv.FormatInt(n, 10) }
func ftoa(f float64) string { return strconv.FormatFloat(f, 'f', 3, 64) }
