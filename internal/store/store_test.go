package store

import (
	"context"
	"path/filepath"
	"testing"
)

func TestOpenMigrateSettings(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "t.db")
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.InitSetting(ctx, "k", "a"); err != nil {
		t.Fatal(err)
	}
	s.InitSetting(ctx, "k", "b") // must not overwrite
	if v, _ := s.Setting(ctx, "k", ""); v != "a" {
		t.Errorf("InitSetting overwrote: %q", v)
	}
	s.SetSetting(ctx, "k", "c")
	if v, _ := s.Setting(ctx, "k", ""); v != "c" {
		t.Errorf("SetSetting: %q", v)
	}
	if v, _ := s.Setting(ctx, "missing", "def"); v != "def" {
		t.Errorf("default: %q", v)
	}
	if _, err := s.R.ExecContext(ctx, "INSERT INTO settings VALUES ('x','y')"); err == nil {
		t.Error("read pool accepted a write")
	}
	s.Close()

	// Reopen: migrations must be idempotent and data kept.
	s, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	var version, fk int
	s.R.QueryRow("PRAGMA user_version").Scan(&version)
	s.W.QueryRow("PRAGMA foreign_keys").Scan(&fk)
	if version < 1 || fk != 1 {
		t.Errorf("user_version=%d foreign_keys=%d", version, fk)
	}
	if v, _ := s.Setting(ctx, "k", ""); v != "c" {
		t.Errorf("after reopen: %q", v)
	}
}

func TestServerSettings(t *testing.T) {
	ctx := context.Background()
	s, err := Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	s.InitServerSettings(ctx, 7, "API.example.com, *.test")
	s.InitServerSettings(ctx, 99, "") // env only seeds once
	got, _ := s.ServerSettings(ctx)
	if got.RetentionDays != 7 || len(got.TargetAllowlist) != 2 || got.TargetAllowlist[0] != "api.example.com" || got.AllowLinkLocal {
		t.Errorf("seeded %+v", got)
	}
	for _, bad := range []string{"a*", "http://x", "x:80", "*.", "*.*.x"} {
		if s.SaveServerSettings(ctx, ServerSettings{RetentionDays: 7, TargetAllowlist: []string{bad}}) == nil {
			t.Errorf("accepted host %q", bad)
		}
	}
	if err := s.SaveServerSettings(ctx, ServerSettings{RetentionDays: 3, TargetAllowlist: []string{}, AllowLinkLocal: true}); err != nil {
		t.Fatal(err)
	}
	if got, _ = s.ServerSettings(ctx); got.RetentionDays != 3 || len(got.TargetAllowlist) != 0 || !got.AllowLinkLocal {
		t.Errorf("saved %+v", got)
	}
}
