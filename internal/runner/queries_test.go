package runner

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"

	"github.com/Gudboi-UwU/ndswarm/internal/store"
)

// TestListFilterByResult checks the history filter's verdict/rules split: "passed" only matches
// finished runs whose rules all held, "norules" matches finished runs with no rules configured,
// and "failed" matches a broken rule, separately from status filters like "aborted" or "error".
func TestListFilterByResult(t *testing.T) {
	ctx := context.Background()
	db, err := store.Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	r := &Runner{db: db}

	insert := func(status, verdict string, rulesCount int) int64 {
		v := sql.NullString{String: verdict, Valid: verdict != ""}
		res, err := db.W.ExecContext(ctx, `INSERT INTO runs (test_name, config_json, keys_json, status, verdict, started_at, created_by, rules_count)
			VALUES ('t', '{}', '[]', ?, ?, 0, 'u', ?)`, status, v, rulesCount)
		if err != nil {
			t.Fatal(err)
		}
		id, _ := res.LastInsertId()
		return id
	}
	passed := insert("finished", "pass", 2)
	failed := insert("finished", "fail", 2)
	norules := insert("finished", "pass", 0)
	aborted := insert("aborted", "", 0)
	errored := insert("failed", "", 0)
	running := insert("running", "", 0)

	check := func(result string, want int64) {
		t.Helper()
		got, err := r.List(ctx, RunFilter{Result: result})
		if err != nil {
			t.Fatal(err)
		}
		if len(got) != 1 || got[0].ID != want {
			t.Errorf("result=%s: got %+v, want [%d]", result, got, want)
		}
	}
	check("passed", passed)
	check("failed", failed)
	check("norules", norules)
	check("aborted", aborted)
	check("error", errored)
	check("running", running)

	all, err := r.List(ctx, RunFilter{})
	if err != nil || len(all) != 6 {
		t.Errorf("no filter: got %d runs, want 6 (%v)", len(all), err)
	}
}
