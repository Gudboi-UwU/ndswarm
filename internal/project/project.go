// Package project stores projects, their environments and their tests.
package project

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/Gudboi-UwU/ndswarm/internal/model"
	"github.com/Gudboi-UwU/ndswarm/internal/secret"
	"github.com/Gudboi-UwU/ndswarm/internal/store"
)

var ErrNotFound = errors.New("not found")

type Service struct {
	db  *store.Store
	box *secret.Box
	now func() time.Time
}

func New(db *store.Store, box *secret.Box) *Service {
	return &Service{db: db, box: box, now: time.Now}
}

// ---- projects

func (s *Service) ListProjects(ctx context.Context) ([]model.Project, error) {
	rows, err := s.db.R.QueryContext(ctx, `
		SELECT p.id, p.name, p.description, p.created_at, (SELECT count(*) FROM tests t WHERE t.project_id = p.id),
			(SELECT count(*) FROM environments e WHERE e.project_id = p.id), (SELECT max(started_at) FROM runs r WHERE r.project_id = p.id)
		FROM projects p ORDER BY p.name COLLATE NOCASE`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []model.Project{}
	for rows.Next() {
		var p model.Project
		if err := rows.Scan(&p.ID, &p.Name, &p.Description, &p.CreatedAt, &p.TestCount, &p.TargetCount, &p.LastRunAt); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func (s *Service) GetProject(ctx context.Context, id int64) (model.Project, error) {
	var p model.Project
	err := s.db.R.QueryRowContext(ctx, `
		SELECT id, name, description, created_at, (SELECT count(*) FROM tests WHERE project_id = ?)
		FROM projects WHERE id = ?`, id, id).Scan(&p.ID, &p.Name, &p.Description, &p.CreatedAt, &p.TestCount)
	return p, notFound(err)
}

func (s *Service) CreateProject(ctx context.Context, p model.Project) (model.Project, error) {
	p.Name = strings.TrimSpace(p.Name)
	if err := p.Validate(); err != nil {
		return p, err
	}
	p.CreatedAt = s.now().UnixMilli()
	res, err := s.db.W.ExecContext(ctx, "INSERT INTO projects (name, description, created_at) VALUES (?, ?, ?)",
		p.Name, p.Description, p.CreatedAt)
	if err != nil {
		return p, err
	}
	p.ID, _ = res.LastInsertId()
	return p, nil
}

func (s *Service) UpdateProject(ctx context.Context, p model.Project) (model.Project, error) {
	p.Name = strings.TrimSpace(p.Name)
	if err := p.Validate(); err != nil {
		return p, err
	}
	if err := affected(s.db.W.ExecContext(ctx, "UPDATE projects SET name = ?, description = ? WHERE id = ?",
		p.Name, p.Description, p.ID)); err != nil {
		return p, err
	}
	return s.GetProject(ctx, p.ID)
}

// DeleteProject removes the project with its environments and tests.
func (s *Service) DeleteProject(ctx context.Context, id int64) error {
	return affected(s.db.W.ExecContext(ctx, "DELETE FROM projects WHERE id = ?", id))
}

// ---- environments

func (s *Service) ListEnvironments(ctx context.Context, projectID int64) ([]model.Environment, error) {
	if _, err := s.GetProject(ctx, projectID); err != nil {
		return nil, err
	}
	rows, err := s.db.R.QueryContext(ctx,
		"SELECT id, project_id, config_json FROM environments WHERE project_id = ? ORDER BY name COLLATE NOCASE", projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []model.Environment{}
	for rows.Next() {
		e, err := s.scanEnv(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// GetEnvironment returns the environment with secrets decrypted. Mask before sending it to a client.
func (s *Service) GetEnvironment(ctx context.Context, id int64) (model.Environment, error) {
	row := s.db.R.QueryRowContext(ctx, "SELECT id, project_id, config_json FROM environments WHERE id = ?", id)
	e, err := s.scanEnv(row)
	return e, notFound(err)
}

func (s *Service) CreateEnvironment(ctx context.Context, e model.Environment) (model.Environment, error) {
	if _, err := s.GetProject(ctx, e.ProjectID); err != nil {
		return e, err
	}
	e.Normalize()
	e.KeepSecrets(&model.Environment{}) // a new environment has nothing to keep: drop stray masks
	if err := e.Validate(); err != nil {
		return e, err
	}
	blob, err := s.sealEnv(e)
	if err != nil {
		return e, err
	}
	res, err := s.db.W.ExecContext(ctx, "INSERT INTO environments (project_id, name, config_json) VALUES (?, ?, ?)",
		e.ProjectID, e.Name, blob)
	if err != nil {
		return e, err
	}
	e.ID, _ = res.LastInsertId()
	return e, nil
}

// UpdateEnvironment replaces the environment. Secret values sent as model.Masked are kept.
func (s *Service) UpdateEnvironment(ctx context.Context, e model.Environment) (model.Environment, error) {
	stored, err := s.GetEnvironment(ctx, e.ID)
	if err != nil {
		return e, err
	}
	e.ProjectID = stored.ProjectID
	e.Normalize()
	e.KeepSecrets(&stored)
	if err := e.Validate(); err != nil {
		return e, err
	}
	blob, err := s.sealEnv(e)
	if err != nil {
		return e, err
	}
	return e, affected(s.db.W.ExecContext(ctx, "UPDATE environments SET name = ?, config_json = ? WHERE id = ?", e.Name, blob, e.ID))
}

func (s *Service) DeleteEnvironment(ctx context.Context, id int64) error {
	return affected(s.db.W.ExecContext(ctx, "DELETE FROM environments WHERE id = ?", id))
}

func (s *Service) sealEnv(e model.Environment) (string, error) {
	if err := e.MapSecrets(func(v string) (string, error) { return s.box.Seal(v), nil }); err != nil {
		return "", err
	}
	b, err := json.Marshal(e)
	return string(b), err
}

func (s *Service) scanEnv(row interface{ Scan(...any) error }) (model.Environment, error) {
	var e model.Environment
	var id, projectID int64
	var blob string
	if err := row.Scan(&id, &projectID, &blob); err != nil {
		return e, err
	}
	if err := json.Unmarshal([]byte(blob), &e); err != nil {
		return e, fmt.Errorf("environment %d: %w", id, err)
	}
	e.ID, e.ProjectID = id, projectID
	e.Normalize()
	if err := e.MapSecrets(s.box.Open); err != nil {
		return e, fmt.Errorf("environment %d: %w", id, err)
	}
	return e, nil
}

// ---- tests

// TestSummary is a row in the project's test list.
type TestSummary struct {
	ID            int64  `json:"id"`
	Name          string `json:"name"`
	Description   string `json:"description"`
	Folder        string `json:"folder"`
	EnvironmentID *int64 `json:"environmentId"`
	Endpoints     int    `json:"endpoints"`
	UpdatedAt     int64  `json:"updatedAt"`
	ProjectID     int64  `json:"projectId,omitempty"`
	ProjectName   string `json:"projectName,omitempty"`
	TargetName    string `json:"targetName,omitempty"`
	TargetURL     string `json:"targetUrl,omitempty"`
	LastRunAt     *int64 `json:"lastRunAt"`
}

// ListAllTests returns every test, newest change first, with its project.
// ListAllTests returns every test, newest change first, with its project and server.
func (s *Service) ListAllTests(ctx context.Context) ([]TestSummary, error) {
	return s.listTests(ctx, 0)
}

// ListTests returns the tests of one project.
func (s *Service) ListTests(ctx context.Context, projectID int64) ([]TestSummary, error) {
	if _, err := s.GetProject(ctx, projectID); err != nil {
		return nil, err
	}
	return s.listTests(ctx, projectID)
}

func (s *Service) listTests(ctx context.Context, projectID int64) ([]TestSummary, error) {
	rows, err := s.db.R.QueryContext(ctx, `
		SELECT t.id, t.name, t.description, t.folder, t.environment_id, json_array_length(t.config_json, '$.flows'), t.updated_at,
			t.project_id, p.name, coalesce(e.name, ''), coalesce(json_extract(e.config_json, '$.baseUrl'), ''),
			(SELECT max(started_at) FROM runs WHERE test_id = t.id)
		FROM tests t JOIN projects p ON p.id = t.project_id LEFT JOIN environments e ON e.id = t.environment_id
		WHERE ? = 0 OR t.project_id = ?
		ORDER BY t.updated_at DESC, t.id DESC`, projectID, projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []TestSummary{}
	for rows.Next() {
		var t TestSummary
		if err := rows.Scan(&t.ID, &t.Name, &t.Description, &t.Folder, &t.EnvironmentID, &t.Endpoints, &t.UpdatedAt,
			&t.ProjectID, &t.ProjectName, &t.TargetName, &t.TargetURL, &t.LastRunAt); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

func (s *Service) GetTest(ctx context.Context, id int64) (model.Test, error) {
	var t model.Test
	var blob string
	err := s.db.R.QueryRowContext(ctx,
		"SELECT id, project_id, environment_id, name, description, folder, config_json, updated_at FROM tests WHERE id = ?", id).
		Scan(&t.ID, &t.ProjectID, &t.EnvironmentID, &t.Name, &t.Description, &t.Folder, &blob, &t.UpdatedAt)
	if err != nil {
		return t, notFound(err)
	}
	var cfg testConfig
	if err := json.Unmarshal([]byte(blob), &cfg); err != nil {
		return t, fmt.Errorf("test %d: %w", id, err)
	}
	t.Flows, t.Load, t.Thresholds = cfg.Flows, cfg.Load, cfg.Thresholds
	t.Settings = model.DefaultSettings
	if len(cfg.Settings) > 0 {
		if err := json.Unmarshal(cfg.Settings, &t.Settings); err != nil {
			return t, fmt.Errorf("test %d settings: %w", id, err)
		}
	}
	t.Normalize()
	return t, nil
}

// testConfig is what config_json holds; columns carry the rest.
type testConfig struct {
	Flows      []model.Flow      `json:"flows"`
	Load       model.Load        `json:"load"`
	Settings   json.RawMessage   `json:"settings"` // decoded over DefaultSettings so newer fields get defaults
	Thresholds []model.Threshold `json:"thresholds"`
}

func (s *Service) CreateTest(ctx context.Context, t model.Test) (model.Test, error) {
	t.ID = 0
	return s.saveTest(ctx, t)
}

// UpdateTest replaces the test's content. ProjectID cannot change.
func (s *Service) UpdateTest(ctx context.Context, t model.Test) (model.Test, error) {
	stored, err := s.GetTest(ctx, t.ID)
	if err != nil {
		return t, err
	}
	t.ProjectID = stored.ProjectID
	return s.saveTest(ctx, t)
}

func (s *Service) saveTest(ctx context.Context, t model.Test) (model.Test, error) {
	if _, err := s.GetProject(ctx, t.ProjectID); err != nil {
		return t, err
	}
	t.Name = strings.TrimSpace(t.Name)
	t.Normalize()
	if err := t.Validate(); err != nil {
		return t, err
	}
	if t.EnvironmentID != nil {
		env, err := s.GetEnvironment(ctx, *t.EnvironmentID)
		if err != nil || env.ProjectID != t.ProjectID {
			return t, model.ValidationError{{Path: "environmentId", Message: "Choose an environment of this project."}}
		}
	}
	settings, _ := json.Marshal(t.Settings)
	blob, err := json.Marshal(testConfig{Flows: t.Flows, Load: t.Load, Settings: settings, Thresholds: t.Thresholds})
	if err != nil {
		return t, err
	}
	t.UpdatedAt = s.now().UnixMilli()
	if t.ID == 0 {
		res, err := s.db.W.ExecContext(ctx, `INSERT INTO tests (project_id, environment_id, name, description, folder, config_json, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?)`, t.ProjectID, t.EnvironmentID, t.Name, t.Description, t.Folder, string(blob), t.UpdatedAt)
		if err != nil {
			return t, err
		}
		t.ID, _ = res.LastInsertId()
		return t, nil
	}
	return t, affected(s.db.W.ExecContext(ctx, `UPDATE tests SET environment_id = ?, name = ?, description = ?, folder = ?, config_json = ?, updated_at = ?
		WHERE id = ?`, t.EnvironmentID, t.Name, t.Description, t.Folder, string(blob), t.UpdatedAt, t.ID))
}

// RenameFolder moves every test in the project whose folder is exactly from, or a subfolder of it,
// under to. Renaming "" (no folder) is a no-op: there is nothing to match unambiguously.
func (s *Service) RenameFolder(ctx context.Context, projectID int64, from, to string) error {
	if _, err := s.GetProject(ctx, projectID); err != nil {
		return err
	}
	from, to = model.NormalizeFolder(from), model.NormalizeFolder(to)
	if from == "" || from == to {
		return nil
	}
	if err := model.ValidateFolder(to); err != nil {
		return err
	}
	now := s.now().UnixMilli()
	exact, err := s.db.W.ExecContext(ctx, `UPDATE tests SET folder = ?, updated_at = ? WHERE project_id = ? AND folder = ?`, to, now, projectID, from)
	if err != nil {
		return err
	}
	prefix := from + " / "
	// substr/length instead of LIKE: a folder name can itself contain "%" or "_". SQLite's substr
	// indexes by character, so use the rune count, not the byte length.
	plen := utf8.RuneCountInString(prefix)
	sub, err := s.db.W.ExecContext(ctx,
		`UPDATE tests SET folder = ? || ' / ' || substr(folder, ?), updated_at = ? WHERE project_id = ? AND substr(folder, 1, ?) = ?`,
		to, plen+1, now, projectID, plen, prefix)
	if err != nil {
		return err
	}
	n1, _ := exact.RowsAffected()
	n2, _ := sub.RowsAffected()
	if n1+n2 == 0 {
		return ErrNotFound
	}
	return nil
}

// MoveTest sets a test's folder, leaving everything else about it unchanged.
func (s *Service) MoveTest(ctx context.Context, id int64, folder string) (model.Test, error) {
	t, err := s.GetTest(ctx, id)
	if err != nil {
		return t, err
	}
	t.Folder = folder
	return s.saveTest(ctx, t)
}

func (s *Service) DuplicateTest(ctx context.Context, id int64) (model.Test, error) {
	t, err := s.GetTest(ctx, id)
	if err != nil {
		return t, err
	}
	t.Name = copyName(t.Name)
	return s.CreateTest(ctx, t)
}

func (s *Service) DeleteTest(ctx context.Context, id int64) error {
	return affected(s.db.W.ExecContext(ctx, "DELETE FROM tests WHERE id = ?", id))
}

func copyName(name string) string {
	const suffix = " (copy)"
	r := []rune(name)
	if max := model.MaxNameLen - len(suffix); len(r) > max {
		r = r[:max]
	}
	return string(r) + suffix
}

func notFound(err error) error {
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	return err
}

func affected(res sql.Result, err error) error {
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}
