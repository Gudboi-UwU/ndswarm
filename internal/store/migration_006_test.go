package store

import (
	"database/sql"
	"testing"

	_ "modernc.org/sqlite"
)

// TestFolderColumnDefault runs migrations 001-005 (before the folder column existed), inserts a
// test the way it looked before, then applies 006 and checks the backfilled column reads as "".
func TestFolderColumnDefault(t *testing.T) {
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	for _, name := range []string{"001_auth.sql", "002_projects.sql", "003_runs.sql", "004_logs.sql", "005_run_rules.sql"} {
		body, err := migrations.ReadFile("migrations/" + name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := db.Exec(string(body)); err != nil {
			t.Fatalf("%s: %v", name, err)
		}
	}
	if _, err := db.Exec(`INSERT INTO projects (id, name, created_at) VALUES (1, 'p', 0)`); err != nil {
		t.Fatal(err)
	}
	res, err := db.Exec(`INSERT INTO tests (project_id, name, config_json, updated_at) VALUES (1, 't', '{}', 0)`)
	if err != nil {
		t.Fatal(err)
	}
	id, _ := res.LastInsertId()

	body, err := migrations.ReadFile("migrations/006_test_folders.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(string(body)); err != nil {
		t.Fatal(err)
	}

	var folder string
	if err := db.QueryRow("SELECT folder FROM tests WHERE id = ?", id).Scan(&folder); err != nil {
		t.Fatal(err)
	}
	if folder != "" {
		t.Errorf("folder = %q, want \"\"", folder)
	}
}
