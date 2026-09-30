// Package runner owns run lifecycle: preflight, the single active run, persistence and recovery.
package runner

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/Gudboi-UwU/ndswarm/internal/engine"
	"github.com/Gudboi-UwU/ndswarm/internal/logsink"
	"github.com/Gudboi-UwU/ndswarm/internal/metrics"
	"github.com/Gudboi-UwU/ndswarm/internal/model"
	"github.com/Gudboi-UwU/ndswarm/internal/project"
	"github.com/Gudboi-UwU/ndswarm/internal/store"
)

var (
	ErrNotFound  = errors.New("run not found")
	ErrNotActive = errors.New("this run is not running")
)

// ActiveError is returned when a start is attempted while another run is going.
type ActiveError struct{ RunID int64 }

func (e ActiveError) Error() string { return "a test is already running" }

// PreflightError is returned when preflight blocks a start (or warns without force).
type PreflightError struct{ Result Preflight }

func (e PreflightError) Error() string { return "preflight did not pass" }

// Publisher receives live messages for WebSocket subscribers.
type Publisher interface {
	Publish(runID int64, msg any)
}

type Runner struct {
	db       *store.Store
	projects *project.Service
	pub      Publisher
	now      func() time.Time

	mu     sync.Mutex
	active *active // nil when idle; set during preflight too, so two starts cannot race
}

type active struct {
	id     int64 // 0 while in preflight
	cancel context.CancelCauseFunc
	done   chan struct{}

	logs       *logsink.Sink
	thresholds []model.Threshold

	mu   sync.Mutex
	last *TickMsg
}

func New(db *store.Store, projects *project.Service, pub Publisher) *Runner {
	return &Runner{db: db, projects: projects, pub: pub, now: time.Now}
}

// Recover marks runs left unfinished by a previous process as aborted. Call once at boot.
func (r *Runner) Recover(ctx context.Context) error {
	res, err := r.db.W.ExecContext(ctx, `UPDATE runs SET status = 'aborted', end_reason = 'instance restarted', ended_at = ?
		WHERE status IN ('running', 'stopping')`, r.now().UnixMilli())
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n > 0 {
		slog.Warn("marked interrupted runs as aborted", "count", n)
	}
	return nil
}

// ActiveID returns the running run's id, or 0.
func (r *Runner) ActiveID() int64 {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.active == nil {
		return 0
	}
	return r.active.id
}

// Start runs preflight and then the test. force starts despite preflight warnings (never despite errors).
func (r *Runner) Start(ctx context.Context, testID int64, user string, force bool) (int64, error) {
	r.mu.Lock()
	if r.active != nil {
		id := r.active.id
		r.mu.Unlock()
		return 0, ActiveError{RunID: id}
	}
	a := &active{done: make(chan struct{})}
	r.active = a
	r.mu.Unlock()
	release := func() {
		r.mu.Lock()
		r.active = nil
		r.mu.Unlock()
	}

	pf, plan, test, env, err := r.preflight(ctx, testID)
	if err != nil {
		release()
		return 0, err
	}
	if len(pf.Errors) > 0 || (len(pf.Warnings) > 0 && !force) {
		release()
		return 0, PreflightError{pf}
	}

	id, err := r.insertRun(ctx, test, env, plan, user)
	if err != nil {
		release()
		return 0, err
	}
	runCtx, cancel := context.WithCancelCause(context.Background())
	r.mu.Lock()
	a.id, a.cancel = id, cancel
	a.logs = logsink.New(r.db, id, len(plan.Keys), plan.Settings.LogSamplePct)
	a.thresholds = test.Thresholds
	r.mu.Unlock()
	r.event(id, "start", map[string]any{"by": user, "forced": force && len(pf.Warnings) > 0})
	go r.run(runCtx, a, plan)
	return id, nil
}

// Stop ends the active run with reason. Interrupted requests are not counted.
func (r *Runner) Stop(ctx context.Context, runID int64, reason string) error {
	r.mu.Lock()
	a := r.active
	r.mu.Unlock()
	if a == nil || a.id != runID {
		if _, err := r.Get(ctx, runID); err != nil {
			return err
		}
		return ErrNotActive
	}
	if _, err := r.db.W.ExecContext(ctx, "UPDATE runs SET status = 'stopping' WHERE id = ? AND status = 'running'", runID); err != nil {
		return err
	}
	r.pub.Publish(runID, StatusMsg{Type: "run.status", RunID: runID, Status: "stopping"})
	a.cancel(errors.New(reason))
	return nil
}

// Shutdown stops the active run (SIGTERM) and waits for its results to be written.
func (r *Runner) Shutdown(ctx context.Context) {
	r.mu.Lock()
	a := r.active
	r.mu.Unlock()
	if a == nil || a.cancel == nil {
		return
	}
	a.cancel(errors.New("server shutting down"))
	select {
	case <-a.done:
	case <-ctx.Done():
		slog.Error("run did not finish before shutdown deadline", "run", a.id)
	}
}

func (r *Runner) run(ctx context.Context, a *active, plan *engine.Plan) {
	id := a.id
	status, reason := "finished", ""
	rec := metrics.NewRecorder(len(plan.Keys))
	var last engine.Tick
	func() {
		defer func() {
			if p := recover(); p != nil {
				status, reason = "failed", fmt.Sprintf("internal error: %v", p)
				slog.Error("run panicked", "run", id, "panic", p)
			}
		}()
		engine.Run(ctx, plan, rec, a.logs, func(t engine.Tick) {
			last = t
			a.logs.Tick()
			msg := r.tickMsg(id, t)
			msg.DroppedLogs = a.logs.Dropped()
			a.mu.Lock()
			a.last = &msg
			a.mu.Unlock()
			if err := r.writeSecond(id, t); err != nil {
				slog.Error("write metrics", "run", id, "err", err)
			}
			r.pub.Publish(id, msg)
		})
	}()
	if status == "finished" && ctx.Err() != nil {
		status, reason = "aborted", context.Cause(ctx).Error()
	}
	a.logs.Close()
	verdict, results := computeVerdict(status, a.thresholds, last.Snap.Total)
	if err := r.finish(id, status, reason, rec, plan, last, a.logs.Dropped(), verdict, results); err != nil {
		slog.Error("finish run", "run", id, "err", err)
	}
	r.mu.Lock()
	r.active = nil
	r.mu.Unlock()
	close(a.done)
	r.pub.Publish(id, StatusMsg{Type: "run.status", RunID: id, Status: status, Verdict: verdict, EndReason: reason})
}

// computeVerdict evaluates the test's pass/fail rules against the run's final totals.
// Only a run that finished on its own gets a verdict; aborted or failed runs get none.
func computeVerdict(status string, rules []model.Threshold, total metrics.Stats) (string, []ThresholdResult) {
	if status != "finished" {
		return "", nil
	}
	if len(rules) == 0 {
		return "pass", nil
	}
	results, ok := EvaluateThresholds(rules, total)
	if ok {
		return "pass", results
	}
	return "fail", results
}

// TickMsg is the WebSocket "run.tick" message.
type TickMsg struct {
	Type              string             `json:"type"`
	RunID             int64              `json:"runId"`
	T                 int64              `json:"t"`
	ElapsedSec        float64            `json:"elapsedSec"`
	Status            string             `json:"status"`
	VUs               int                `json:"vus"`
	TargetVUs         int                `json:"targetVus"`
	Total             metrics.Stats      `json:"total"`
	Recent            metrics.Stats      `json:"recent5s"`
	Second            metrics.Stats      `json:"second"`
	Keys              []metrics.KeyStats `json:"keys"`
	Codes             map[string]int64   `json:"codes"`
	DroppedLogs       int64              `json:"droppedLogs"`
	DroppedIterations int64              `json:"droppedIterations"`
}

// StatusMsg is the WebSocket "run.status" message.
type StatusMsg struct {
	Type      string `json:"type"`
	RunID     int64  `json:"runId"`
	Status    string `json:"status"`
	Verdict   string `json:"verdict,omitempty"`
	EndReason string `json:"endReason,omitempty"`
}

func (r *Runner) tickMsg(id int64, t engine.Tick) TickMsg {
	return TickMsg{
		Type: "run.tick", RunID: id, T: r.now().UnixMilli(), ElapsedSec: t.Elapsed, Status: "running",
		VUs: t.VUs, TargetVUs: t.Target, Total: t.Snap.Total, Recent: t.Snap.Recent, Second: t.Snap.Second,
		Keys: t.Snap.Keys, Codes: t.Snap.Codes,
	}
}

// writeSecond stores the second that just closed, for the whole run and each key with traffic.
func (r *Runner) writeSecond(id int64, t engine.Tick) error {
	tx, err := r.db.W.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	stmt, err := tx.Prepare(`INSERT OR REPLACE INTO metrics_1s (run_id, key_id, t, count, ok, err, avg_ms, min_ms, max_ms, p50, p90, p95, p99,
		bytes_in, bytes_out, dns, connect, tls, ttfb, download, vus) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
	if err != nil {
		return err
	}
	defer stmt.Close()
	sec := int64(t.Elapsed + 0.5)
	write := func(key int, s metrics.Stats, p metrics.Phases) error {
		_, err := stmt.Exec(id, key, sec, s.Count, s.OK, s.Err, s.Avg, s.Min, s.Max, s.P50, s.P90, s.P95, s.P99,
			s.BytesIn, s.BytesOut, p.DNS, p.Connect, p.TLS, p.TTFB, p.Download, t.VUs)
		return err
	}
	if err := write(-1, t.Snap.Second, t.Snap.SecondPhases); err != nil {
		return err
	}
	if iv := t.Snap.Interval; iv != nil {
		if _, err := tx.Exec("INSERT OR REPLACE INTO metrics_hdr (run_id, key_id, bucket, hdr) VALUES (?, -1, ?, ?)",
			id, fmt.Sprintf("%ds:%d", metrics.IntervalSec, iv.Index), iv.HDR); err != nil {
			return err
		}
	}
	for _, k := range t.Snap.Keys {
		if k.Second.Count > 0 {
			if err := write(k.Key, k.Second, k.Phases); err != nil {
				return err
			}
		}
	}
	return tx.Commit()
}

// Summary is the final (or latest live) state of a run.
type Summary struct {
	ElapsedSec  float64            `json:"elapsedSec"`
	DroppedLogs int64              `json:"droppedLogs"`
	Total       metrics.Stats      `json:"total"`
	Keys        []metrics.KeyStats `json:"keys"`
	Codes       map[string]int64   `json:"codes"`
	Thresholds  []ThresholdResult  `json:"thresholds,omitempty"`
}

func (r *Runner) finish(id int64, status, reason string, rec *metrics.Recorder, plan *engine.Plan, last engine.Tick, dropped int64, verdict string, results []ThresholdResult) error {
	summary, err := json.Marshal(Summary{ElapsedSec: last.Elapsed, DroppedLogs: dropped, Total: last.Snap.Total, Keys: last.Snap.Keys, Codes: last.Snap.Codes, Thresholds: results})
	if err != nil {
		return err
	}
	tx, err := r.db.W.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var verdictArg any
	if verdict != "" {
		verdictArg = verdict
	}
	if _, err := tx.Exec("UPDATE runs SET status = ?, verdict = ?, end_reason = ?, ended_at = ?, summary_json = ? WHERE id = ?",
		status, verdictArg, reason, r.now().UnixMilli(), string(summary), id); err != nil {
		return err
	}
	if iv := rec.FinalInterval(); iv != nil {
		tx.Exec("INSERT OR REPLACE INTO metrics_hdr (run_id, key_id, bucket, hdr) VALUES (?, -1, ?, ?)", id, fmt.Sprintf("%ds:%d", metrics.IntervalSec, iv.Index), iv.HDR)
	}
	if b, err := rec.Histogram(); err == nil {
		tx.Exec("INSERT INTO metrics_hdr (run_id, key_id, bucket, hdr) VALUES (?, -1, 'total', ?)", id, b)
	}
	for k := range plan.Keys {
		if b, err := rec.KeyHistogram(k); err == nil {
			tx.Exec("INSERT INTO metrics_hdr (run_id, key_id, bucket, hdr) VALUES (?, ?, 'total', ?)", id, k, b)
		}
		for code, n := range rec.KeyCodes(k) {
			tx.Exec("INSERT INTO status_counts (run_id, key_id, code, count) VALUES (?, ?, ?, ?)", id, k, code, n)
		}
	}
	tx.Exec("INSERT INTO run_events (run_id, t_ms, type, data_json) VALUES (?, ?, 'finish', ?)", id, r.now().UnixMilli(),
		mustJSON(map[string]string{"status": status, "reason": reason}))
	return tx.Commit()
}

func (r *Runner) insertRun(ctx context.Context, t model.Test, env *model.Environment, plan *engine.Plan, user string) (int64, error) {
	envName := ""
	if env != nil {
		envName = env.Name
	}
	cfg := mustJSON(map[string]any{"flows": t.Flows, "load": t.Load, "settings": t.Settings, "environment": envName})
	res, err := r.db.W.ExecContext(ctx, `INSERT INTO runs (test_id, project_id, test_name, config_json, keys_json, status, started_at, created_by)
		VALUES (?, ?, ?, ?, ?, 'running', ?, ?)`, t.ID, t.ProjectID, t.Name, cfg, mustJSON(plan.Keys), r.now().UnixMilli(), user)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

func (r *Runner) event(id int64, typ string, data any) {
	if _, err := r.db.W.Exec("INSERT INTO run_events (run_id, t_ms, type, data_json) VALUES (?, ?, ?, ?)", id, r.now().UnixMilli(), typ, mustJSON(data)); err != nil {
		slog.Error("run event", "run", id, "err", err)
	}
}

func mustJSON(v any) string {
	b, err := json.Marshal(v)
	if err != nil {
		panic(err)
	}
	return string(b)
}

func notFound(err error) error {
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	return err
}
