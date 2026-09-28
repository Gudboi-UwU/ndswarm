package runner

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/Gudboi-UwU/ndswarm/internal/logsink"
	"github.com/Gudboi-UwU/ndswarm/internal/metrics"
)

// ---- request logs

// LogFilter narrows the log explorer. Zero values mean "any".
type LogFilter struct {
	Key      *int
	Status   int
	Category string // "ok", "error", or a specific category
	Reason   string
	MinMs    float64
	FromSec  *int64
	ToSec    *int64
	VU       int
	After    int64 // cursor: return ids greater than this
	Limit    int
}

type LogRow struct {
	ID        int64   `json:"id"`
	TMs       int64   `json:"tMs"`
	Sec       int64   `json:"sec"`
	VU        int     `json:"vu"`
	Iter      int64   `json:"iter"`
	Key       int     `json:"keyId"`
	Status    int     `json:"status"`
	Category  string  `json:"category"`
	LatencyMs float64 `json:"latencyMs"`
	Reason    string  `json:"reason"`
	Error     string  `json:"error"`
}

type LogPage struct {
	Items []LogRow `json:"items"`
	Next  *int64   `json:"next"` // cursor for the following page
}

func (r *Runner) Logs(ctx context.Context, runID int64, f LogFilter) (LogPage, error) {
	if _, err := r.Get(ctx, runID); err != nil {
		return LogPage{}, err
	}
	where := []string{"run_id = ?", "id > ?"}
	args := []any{runID, f.After}
	if f.Key != nil {
		where, args = append(where, "key_id = ?"), append(args, *f.Key)
	}
	if f.Status > 0 {
		where, args = append(where, "status = ?"), append(args, f.Status)
	}
	switch f.Category {
	case "":
	case "ok":
		where = append(where, "category = ''")
	case "error":
		where = append(where, "category <> ''")
	default:
		where, args = append(where, "category = ?"), append(args, f.Category)
	}
	if f.Reason != "" {
		where, args = append(where, "reason = ?"), append(args, f.Reason)
	}
	if f.MinMs > 0 {
		where, args = append(where, "latency_ms >= ?"), append(args, f.MinMs)
	}
	if f.FromSec != nil {
		where, args = append(where, "sec >= ?"), append(args, *f.FromSec)
	}
	if f.ToSec != nil {
		where, args = append(where, "sec <= ?"), append(args, *f.ToSec)
	}
	if f.VU > 0 {
		where, args = append(where, "vu = ?"), append(args, f.VU)
	}
	limit := f.Limit
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	rows, err := r.db.R.QueryContext(ctx, `SELECT id, t_ms, sec, vu, iter, key_id, status, category, latency_ms, reason, error
		FROM request_logs WHERE `+strings.Join(where, " AND ")+` ORDER BY id LIMIT ?`, append(args, limit+1)...)
	if err != nil {
		return LogPage{}, err
	}
	defer rows.Close()
	page := LogPage{Items: []LogRow{}}
	for rows.Next() {
		var l LogRow
		if err := rows.Scan(&l.ID, &l.TMs, &l.Sec, &l.VU, &l.Iter, &l.Key, &l.Status, &l.Category, &l.LatencyMs, &l.Reason, &l.Error); err != nil {
			return page, err
		}
		page.Items = append(page.Items, l)
	}
	if len(page.Items) > limit {
		page.Items = page.Items[:limit]
		next := page.Items[limit-1].ID
		page.Next = &next
	}
	return page, rows.Err()
}

type LogDetail struct {
	LogRow
	Timing   logsink.Timing    `json:"timing"`
	Request  *logsink.Request  `json:"request"`
	Response *logsink.Response `json:"response"`
}

func (r *Runner) Log(ctx context.Context, runID, logID int64) (LogDetail, error) {
	var d LogDetail
	var timing string
	var blob []byte
	err := r.db.R.QueryRowContext(ctx, `SELECT id, t_ms, sec, vu, iter, key_id, status, category, latency_ms, reason, error, timing_json, detail
		FROM request_logs WHERE run_id = ? AND id = ?`, runID, logID).
		Scan(&d.ID, &d.TMs, &d.Sec, &d.VU, &d.Iter, &d.Key, &d.Status, &d.Category, &d.LatencyMs, &d.Reason, &d.Error, &timing, &blob)
	if err != nil {
		return d, notFound(err)
	}
	json.Unmarshal([]byte(timing), &d.Timing)
	d.Request, d.Response, err = logsink.Decompress(blob)
	return d, err
}

// ---- errors

type ErrorsView struct {
	Groups      []logsink.Group  `json:"groups"`
	ByCategory  map[string]int64 `json:"byCategory"`
	DroppedLogs int64            `json:"droppedLogs"`
}

var categories = []string{"http_4xx", "http_5xx", "timeout", "connection", "dns", "tls", "template"}

func (r *Runner) Errors(ctx context.Context, runID int64) (ErrorsView, error) {
	run, err := r.Get(ctx, runID)
	if err != nil {
		return ErrorsView{}, err
	}
	v := ErrorsView{ByCategory: map[string]int64{}, Groups: []logsink.Group{}}
	if run.Summary != nil {
		v.DroppedLogs = run.Summary.DroppedLogs
		for _, c := range categories {
			if n := run.Summary.Codes[c]; n > 0 {
				v.ByCategory[c] = n
			}
		}
	}
	if sink := r.activeSink(runID); sink != nil {
		v.Groups = sink.Groups()
		return v, nil
	}
	rows, err := r.db.R.QueryContext(ctx, `SELECT key_id, category, message, count, example_log_id, first_sec, last_sec
		FROM error_groups WHERE run_id = ? ORDER BY count DESC, message`, runID)
	if err != nil {
		return v, err
	}
	defer rows.Close()
	for rows.Next() {
		var g logsink.Group
		if err := rows.Scan(&g.Key, &g.Category, &g.Message, &g.Count, &g.ExampleLogID, &g.FirstSec, &g.LastSec); err != nil {
			return v, err
		}
		v.Groups = append(v.Groups, g)
	}
	return v, rows.Err()
}

func (r *Runner) activeSink(runID int64) *logsink.Sink {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.active != nil && r.active.id == runID {
		return r.active.logs
	}
	return nil
}

// ---- summary by interval and by status

type IntervalRow struct {
	FromSec int64   `json:"fromSec"`
	ToSec   int64   `json:"toSec"`
	Count   int64   `json:"count"`
	OK      int64   `json:"ok"`
	Err     int64   `json:"err"`
	RPS     float64 `json:"rps"`
	Avg     float64 `json:"avg"`
	P50     float64 `json:"p50"`
	P90     float64 `json:"p90"`
	P95     float64 `json:"p95"`
	P99     float64 `json:"p99"`
	Max     float64 `json:"max"`
}

// Intervals aggregates the whole run per `size` seconds (a multiple of 10). Percentiles
// come from merged 10-second histograms, so they are exact, not averages of averages.
func (r *Runner) Intervals(ctx context.Context, runID int64, size int) ([]IntervalRow, error) {
	if size <= 0 || size%metrics.IntervalSec != 0 {
		return nil, fmt.Errorf("interval must be a multiple of %d seconds", metrics.IntervalSec)
	}
	if _, err := r.Get(ctx, runID); err != nil {
		return nil, err
	}
	per := int64(size / metrics.IntervalSec)
	rows, err := r.db.R.QueryContext(ctx, `SELECT (t - 1) / ?, sum(count), sum(ok), sum(err) FROM metrics_1s
		WHERE run_id = ? AND key_id = -1 AND t > 0 GROUP BY 1 ORDER BY 1`, size, runID)
	if err != nil {
		return nil, err
	}
	out := []IntervalRow{}
	for rows.Next() {
		var b int64
		var row IntervalRow
		if err := rows.Scan(&b, &row.Count, &row.OK, &row.Err); err != nil {
			rows.Close()
			return nil, err
		}
		row.FromSec, row.ToSec = b*int64(size), (b+1)*int64(size)
		row.RPS = float64(row.Count) / float64(size)
		out = append(out, row)
	}
	rows.Close()

	hists := map[int64][][]byte{}
	hr, err := r.db.R.QueryContext(ctx, "SELECT bucket, hdr FROM metrics_hdr WHERE run_id = ? AND key_id = -1 AND bucket LIKE '10s:%'", runID)
	if err != nil {
		return nil, err
	}
	for hr.Next() {
		var bucket string
		var blob []byte
		if err := hr.Scan(&bucket, &blob); err != nil {
			hr.Close()
			return nil, err
		}
		idx, _ := strconv.ParseInt(strings.TrimPrefix(bucket, "10s:"), 10, 64)
		hists[idx/per] = append(hists[idx/per], blob)
	}
	hr.Close()
	for i := range out {
		blobs := hists[out[i].FromSec/int64(size)]
		if len(blobs) == 0 {
			continue // bucket still open on a live run
		}
		merged, err := metrics.MergeEncoded(blobs)
		if err != nil {
			return nil, err
		}
		out[i].Avg, out[i].P50, out[i].P90, out[i].P95, out[i].P99, out[i].Max, _ = metrics.DecodeHistogram(merged)
	}
	return out, nil
}

type StatusRow struct {
	Key   int    `json:"keyId"`
	Code  string `json:"code"`
	Count int64  `json:"count"`
}

// Statuses lists status codes and error categories per key (after the run ends).
func (r *Runner) Statuses(ctx context.Context, runID int64) ([]StatusRow, error) {
	if _, err := r.Get(ctx, runID); err != nil {
		return nil, err
	}
	rows, err := r.db.R.QueryContext(ctx, "SELECT key_id, code, count FROM status_counts WHERE run_id = ? ORDER BY key_id, code", runID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []StatusRow{}
	for rows.Next() {
		var s StatusRow
		if err := rows.Scan(&s.Key, &s.Code, &s.Count); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// ---- history and dashboard

type RunFilter struct {
	TestID    int64
	ProjectID int64
	Status    string
	Before    int64 // cursor: ids lower than this
	Limit     int
}

// Delete removes a finished run with its metrics and logs.
func (r *Runner) Delete(ctx context.Context, id int64) error {
	if r.ActiveID() == id {
		return ErrStillRunning
	}
	res, err := r.db.W.ExecContext(ctx, "DELETE FROM runs WHERE id = ?", id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

var ErrStillRunning = errors.New("stop the run before deleting it")

type Dashboard struct {
	Active *Run  `json:"active"`
	Today  Stat  `json:"today"`
	Week   Stat  `json:"week"`
	Recent []Run `json:"recent"`
}

type Stat struct {
	Runs     int64   `json:"runs"`
	Passed   int64   `json:"passed"`
	Finished int64   `json:"finished"`
	Requests int64   `json:"requests"`
	Errors   int64   `json:"errors"`
	PassRate float64 `json:"passRate"` // of finished runs, 0 when none
}

func (r *Runner) Dashboard(ctx context.Context) (Dashboard, error) {
	var d Dashboard
	if id := r.ActiveID(); id > 0 {
		if run, err := r.Get(ctx, id); err == nil {
			d.Active = &run
		}
	}
	now := r.now()
	midnight := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	var err error
	if d.Today, err = r.stat(ctx, midnight); err != nil {
		return d, err
	}
	if d.Week, err = r.stat(ctx, now.AddDate(0, 0, -7)); err != nil {
		return d, err
	}
	d.Recent, err = r.List(ctx, RunFilter{Limit: 10})
	return d, err
}

func (r *Runner) stat(ctx context.Context, since time.Time) (Stat, error) {
	var s Stat
	err := r.db.R.QueryRowContext(ctx, `SELECT count(*),
			coalesce(sum(verdict = 'pass'), 0), coalesce(sum(status = 'finished'), 0),
			coalesce(sum(json_extract(summary_json, '$.total.count')), 0), coalesce(sum(json_extract(summary_json, '$.total.err')), 0)
		FROM runs WHERE started_at >= ?`, since.UnixMilli()).Scan(&s.Runs, &s.Passed, &s.Finished, &s.Requests, &s.Errors)
	if s.Finished > 0 {
		s.PassRate = float64(s.Passed) / float64(s.Finished)
	}
	if errors.Is(err, sql.ErrNoRows) {
		err = nil
	}
	return s, err
}

// SecondRow is one stored second for one key (-1 = whole run), for exports.
type SecondRow struct {
	Key int `json:"keyId"`
	Point
	Min      float64 `json:"min"`
	Max      float64 `json:"max"`
	P90      float64 `json:"p90"`
	BytesOut int64   `json:"bytesOut"`
}

func (r *Runner) Seconds(ctx context.Context, runID int64) ([]SecondRow, error) {
	rows, err := r.db.R.QueryContext(ctx, `SELECT key_id, t, count, ok, err, avg_ms, min_ms, max_ms, p50, p90, p95, p99, vus, bytes_in, bytes_out
		FROM metrics_1s WHERE run_id = ? ORDER BY t, key_id`, runID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []SecondRow{}
	for rows.Next() {
		var s SecondRow
		if err := rows.Scan(&s.Key, &s.T, &s.Count, &s.OK, &s.Err, &s.Avg, &s.Min, &s.Max, &s.P50, &s.P90, &s.P95, &s.P99, &s.VUs, &s.BytesIn, &s.BytesOut); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}
