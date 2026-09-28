// Package store owns the SQLite database: connection setup and embedded migrations.
package store

import (
	"context"
	"database/sql"
	"embed"
	"errors"
	"fmt"
	"io/fs"
	"net/url"
	"sort"
	"strings"

	_ "modernc.org/sqlite"
)

//go:embed migrations/*.sql
var migrations embed.FS

// Store holds two pools over one file: W has a single connection so writes never
// contend with each other, R serves concurrent reads (WAL lets readers run during writes).
type Store struct {
	W *sql.DB
	R *sql.DB
}

func Open(path string) (*Store, error) {
	dsn := "file:" + url.PathEscape(path) + "?_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)" +
		"&_pragma=journal_mode(WAL)&_pragma=synchronous(NORMAL)"
	w, err := sql.Open("sqlite", dsn+"&_txlock=immediate")
	if err != nil {
		return nil, err
	}
	w.SetMaxOpenConns(1)
	r, err := sql.Open("sqlite", dsn+"&mode=ro")
	if err != nil {
		w.Close()
		return nil, err
	}
	s := &Store{W: w, R: r}
	if err := s.migrate(context.Background()); err != nil {
		s.Close()
		return nil, fmt.Errorf("migrate %s: %w", path, err)
	}
	return s, nil
}

func (s *Store) Close() error {
	return errors.Join(s.R.Close(), s.W.Close())
}

// migrate applies migrations/NNN_*.sql newer than PRAGMA user_version, each in its own transaction.
func (s *Store) migrate(ctx context.Context) error {
	var current int
	if err := s.W.QueryRowContext(ctx, "PRAGMA user_version").Scan(&current); err != nil {
		return err
	}
	if current == 0 {
		// Only takes effect on an empty database; lets retention reclaim space later.
		if _, err := s.W.ExecContext(ctx, "PRAGMA auto_vacuum = INCREMENTAL"); err != nil {
			return err
		}
	}
	names, _ := fs.Glob(migrations, "migrations/*.sql")
	sort.Strings(names)
	for _, name := range names {
		var version int
		if _, err := fmt.Sscanf(strings.TrimPrefix(name, "migrations/"), "%d_", &version); err != nil {
			return fmt.Errorf("bad migration name %s", name)
		}
		if version <= current {
			continue
		}
		body, _ := migrations.ReadFile(name)
		tx, err := s.W.BeginTx(ctx, nil)
		if err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, string(body)); err != nil {
			tx.Rollback()
			return fmt.Errorf("%s: %w", name, err)
		}
		if _, err := tx.ExecContext(ctx, fmt.Sprintf("PRAGMA user_version = %d", version)); err != nil {
			tx.Rollback()
			return err
		}
		if err := tx.Commit(); err != nil {
			return err
		}
	}
	return nil
}

// Setting returns the value for key, or def when unset.
func (s *Store) Setting(ctx context.Context, key, def string) (string, error) {
	var v string
	err := s.R.QueryRowContext(ctx, "SELECT value FROM settings WHERE key = ?", key).Scan(&v)
	if err == sql.ErrNoRows {
		return def, nil
	}
	return v, err
}

func (s *Store) SetSetting(ctx context.Context, key, value string) error {
	_, err := s.W.ExecContext(ctx,
		"INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value", key, value)
	return err
}

// InitSetting stores value only if key has never been set.
func (s *Store) InitSetting(ctx context.Context, key, value string) error {
	_, err := s.W.ExecContext(ctx, "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO NOTHING", key, value)
	return err
}
