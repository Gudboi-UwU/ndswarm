package store

import (
	"database/sql"
	"testing"

	_ "modernc.org/sqlite"
)

// TestBackfillRulesCount runs migrations 001-004 (the pre-rules_count schema), inserts runs the
// way they looked before this column existed, then applies 005 and checks it backfills
// rules_count from summary_json instead of leaving every old run looking like it had no rules.
func TestBackfillRulesCount(t *testing.T) {
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	for _, name := range []string{"001_auth.sql", "002_projects.sql", "003_runs.sql", "004_logs.sql"} {
		body, err := migrations.ReadFile("migrations/" + name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := db.Exec(string(body)); err != nil {
			t.Fatalf("%s: %v", name, err)
		}
	}
	insert := func(status, summary string) int64 {
		res, err := db.Exec(`INSERT INTO runs (test_name, config_json, keys_json, status, started_at, created_by, summary_json)
			VALUES ('t', '{}', '[]', ?, 0, 'u', ?)`, status, sqlNull(summary))
		if err != nil {
			t.Fatal(err)
		}
		id, _ := res.LastInsertId()
		return id
	}
	withRules := insert("finished", `{"thresholds":[{"metric":"avg_ms","op":"<","value":1,"actual":0.5,"passed":true},{"metric":"rps","op":">","value":1,"actual":5,"passed":true}]}`)
	noRules := insert("finished", `{"thresholds":[]}`)
	oldSummary := insert("finished", `{}`) // pre-thresholds summary shape: key absent entirely
	running := insert("running", "")

	body, err := migrations.ReadFile("migrations/005_run_rules.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(string(body)); err != nil {
		t.Fatal(err)
	}

	want := map[int64]int{withRules: 2, noRules: 0, oldSummary: 0, running: 0}
	for id, w := range want {
		var got int
		if err := db.QueryRow("SELECT rules_count FROM runs WHERE id = ?", id).Scan(&got); err != nil {
			t.Fatal(err)
		}
		if got != w {
			t.Errorf("run %d: rules_count=%d, want %d", id, got, w)
		}
	}
}

func sqlNull(s string) any {
	if s == "" {
		return nil
	}
	return s
}
