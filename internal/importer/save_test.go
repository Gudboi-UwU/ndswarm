package importer

import (
	"context"
	"errors"
	"testing"

	"github.com/Gudboi-UwU/ndswarm/internal/model"
	"github.com/Gudboi-UwU/ndswarm/internal/project"
)

// fakeStore is a minimal projectStore that fails CreateTest after the project (and any
// servers) were already created, so Save's cleanup path can be checked without a real DB.
type fakeStore struct {
	failTest bool
	deleted  int64 // project id passed to DeleteProject, 0 if never called
}

func (f *fakeStore) ListEnvironments(context.Context, int64) ([]model.Environment, error) {
	return nil, nil
}
func (f *fakeStore) ListTests(context.Context, int64) ([]project.TestSummary, error) { return nil, nil }
func (f *fakeStore) CreateProject(_ context.Context, p model.Project) (model.Project, error) {
	p.ID = 42
	return p, nil
}
func (f *fakeStore) CreateEnvironment(_ context.Context, e model.Environment) (model.Environment, error) {
	e.ID = 7
	return e, nil
}
func (f *fakeStore) CreateTest(_ context.Context, t model.Test) (model.Test, error) {
	if f.failTest {
		return t, errors.New("db is down")
	}
	t.ID = 1
	return t, nil
}
func (f *fakeStore) DeleteProject(_ context.Context, id int64) error {
	f.deleted = id
	return nil
}

func bundle() Bundle {
	return Bundle{
		Project: ProjectInfo{Name: "Shop"},
		Tests: []Test{{Name: "Checkout", Settings: model.DefaultSettings, Flows: []model.Flow{
			{ID: "f1", Name: "Home", Enabled: true, Weight: 1, Steps: []model.Step{{ID: "s1", Name: "Home", Enabled: true, Method: "GET", URL: "/x", Body: model.Body{Type: "none"}}}},
		}}},
	}
}

func TestSaveCleansUpNewProjectOnFailure(t *testing.T) {
	f := &fakeStore{failTest: true}
	res, err := Save(context.Background(), f, bundle(), 0, "")
	if err == nil {
		t.Fatal("want an error when the test fails to save")
	}
	if f.deleted != res.ProjectID || f.deleted != 42 {
		t.Errorf("cleanup did not run: deleted=%d projectId=%d", f.deleted, res.ProjectID)
	}
}

func TestSaveKeepsNewProjectOnSuccess(t *testing.T) {
	f := &fakeStore{}
	if _, err := Save(context.Background(), f, bundle(), 0, ""); err != nil {
		t.Fatal(err)
	}
	if f.deleted != 0 {
		t.Errorf("cleanup ran on success: deleted=%d", f.deleted)
	}
}
