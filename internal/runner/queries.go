package runner

import (
	"context"
	"database/sql"
	"encoding/json"
	"strings"

	"github.com/Gudboi-UwU/ndswarm/internal/engine"
	"github.com/Gudboi-UwU/ndswarm/internal/model"
)

// Run is a run as the API returns it.
type Run struct {
	ID          int64        `json:"id"`
	TestID      *int64       `json:"testId"`
	ProjectID   *int64       `json:"projectId"`
	TestName    string       `json:"testName"`
	Environment string       `json:"environment"`
	Status      string       `json:"status"`
	Verdict     *string      `json:"verdict"`
	StartedAt   int64        `json:"startedAt"`
	EndedAt     *int64       `json:"endedAt"`
	EndReason   string       `json:"endReason"`
	CreatedBy   string       `json:"createdBy"`
	Load        model.Load   `json:"load"`
	Keys        []engine.Key `json:"keys"`
	Summary     *Summary     `json:"summary"` // final numbers, or the latest second while running
	Live        *TickMsg     `json:"live,omitempty"`
}

const runColumns = `id, test_id, project_id, test_name, config_json, keys_json, status, verdict, started_at, ended_at, end_reason, created_by, summary_json, rules_count`

func scanRun(row interface{ Scan(...any) error }) (Run, error) {
	var r Run
	var cfg, keys string
	var summary sql.NullString
	var rulesCount int
	if err := row.Scan(&r.ID, &r.TestID, &r.ProjectID, &r.TestName, &cfg, &keys, &r.Status, &r.Verdict, &r.StartedAt, &r.EndedAt, &r.EndReason, &r.CreatedBy, &summary, &rulesCount); err != nil {
		return r, err
	}
	var c struct {
		Load        model.Load `json:"load"`
		Environment string     `json:"environment"`
	}
	json.Unmarshal([]byte(cfg), &c)
	r.Load, r.Environment = c.Load, c.Environment
	json.Unmarshal([]byte(keys), &r.Keys)
	if summary.Valid {
		r.Summary = &Summary{}
		json.Unmarshal([]byte(summary.String), r.Summary)
	}
	return r, nil
}

func (r *Runner) Get(ctx context.Context, id int64) (Run, error) {
	run, err := scanRun(r.db.R.QueryRowContext(ctx, "SELECT "+runColumns+" FROM runs WHERE id = ?", id))
	if err != nil {
		return run, notFound(err)
	}
	r.attachLive(&run)
	return run, nil
}

func (r *Runner) attachLive(run *Run) {
	r.mu.Lock()
	a := r.active
	r.mu.Unlock()
	if a == nil || a.id != run.ID {
		return
	}
	a.mu.Lock()
	last := a.last
	a.mu.Unlock()
	if last != nil {
		run.Live = last
		run.Summary = &Summary{ElapsedSec: last.ElapsedSec, DroppedLogs: last.DroppedLogs, Total: last.Total, Keys: last.Keys, Codes: last.Codes}
	}
}

// List returns runs newest first.
func (r *Runner) List(ctx context.Context, f RunFilter) ([]Run, error) {
	where, args := []string{"1 = 1"}, []any{}
	if f.TestID > 0 {
		where, args = append(where, "test_id = ?"), append(args, f.TestID)
	}
	if f.ProjectID > 0 {
		where, args = append(where, "project_id = ?"), append(args, f.ProjectID)
	}
	if f.Status != "" {
		where, args = append(where, "status = ?"), append(args, f.Status)
	}
	switch f.Result {
	case "passed":
		where = append(where, "status = 'finished' AND verdict = 'pass' AND rules_count > 0")
	case "failed":
		where = append(where, "status = 'finished' AND verdict = 'fail'")
	case "norules":
		where = append(where, "status = 'finished' AND verdict = 'pass' AND rules_count = 0")
	case "aborted", "running":
		where, args = append(where, "status = ?"), append(args, f.Result)
	case "error":
		where = append(where, "status = 'failed'")
	}
	if f.Before > 0 {
		where, args = append(where, "id < ?"), append(args, f.Before)
	}
	limit := f.Limit
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	rows, err := r.db.R.QueryContext(ctx, "SELECT "+runColumns+" FROM runs WHERE "+strings.Join(where, " AND ")+" ORDER BY id DESC LIMIT ?", append(args, limit)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Run{}
	for rows.Next() {
		run, err := scanRun(rows)
		if err != nil {
			return nil, err
		}
		r.attachLive(&run)
		out = append(out, run)
	}
	return out, rows.Err()
}

// Point is one second of a series, for charts.
type Point struct {
	T       int64   `json:"t"`
	Count   int64   `json:"count"`
	OK      int64   `json:"ok"`
	Err     int64   `json:"err"`
	Avg     float64 `json:"avg"`
	P50     float64 `json:"p50"`
	P95     float64 `json:"p95"`
	P99     float64 `json:"p99"`
	VUs     int     `json:"vus"`
	BytesIn int64   `json:"bytesIn"`
}

// Timeseries returns per-second points for key (-1 = whole run).
func (r *Runner) Timeseries(ctx context.Context, id int64, key int) ([]Point, error) {
	if _, err := r.Get(ctx, id); err != nil {
		return nil, err
	}
	rows, err := r.db.R.QueryContext(ctx, `SELECT t, count, ok, err, avg_ms, p50, p95, p99, vus, bytes_in FROM metrics_1s
		WHERE run_id = ? AND key_id = ? ORDER BY t`, id, key)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Point{}
	for rows.Next() {
		var p Point
		if err := rows.Scan(&p.T, &p.Count, &p.OK, &p.Err, &p.Avg, &p.P50, &p.P95, &p.P99, &p.VUs, &p.BytesIn); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}
