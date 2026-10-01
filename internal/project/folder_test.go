package project

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/Gudboi-UwU/ndswarm/internal/model"
	"github.com/Gudboi-UwU/ndswarm/internal/secret"
	"github.com/Gudboi-UwU/ndswarm/internal/store"
)

// TestRenameFolder checks that renaming moves tests in the folder itself and in every subfolder,
// leaves tests elsewhere untouched, and that the folder path can contain "%" and "_" (which would
// need escaping if this used LIKE instead of substr/length).
func TestRenameFolder(t *testing.T) {
	ctx := context.Background()
	db, err := store.Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	box, _ := secret.New(make([]byte, 32))
	s := New(db, box)

	p, err := s.CreateProject(ctx, model.Project{Name: "P"})
	if err != nil {
		t.Fatal(err)
	}
	mk := func(name, folder string) model.Test {
		tt, err := s.CreateTest(ctx, model.Test{ProjectID: p.ID, Name: name, Folder: folder, Settings: model.DefaultSettings,
			Flows: []model.Flow{{ID: "f", Name: "f", Enabled: true, Weight: 1, Steps: []model.Step{{ID: "s", Name: "s", Enabled: true, Method: "GET", URL: "/x", Body: model.Body{Type: "none"}}}}}})
		if err != nil {
			t.Fatal(err)
		}
		return tt
	}
	direct := mk("A", "50% off")
	sub := mk("B", "50% off / Sale_1")
	elsewhere := mk("C", "Other")
	none := mk("D", "")

	if err := s.RenameFolder(ctx, p.ID, "50% off", "Deals"); err != nil {
		t.Fatal(err)
	}
	get := func(id int64) string {
		tt, err := s.GetTest(ctx, id)
		if err != nil {
			t.Fatal(err)
		}
		return tt.Folder
	}
	if got := get(direct.ID); got != "Deals" {
		t.Errorf("direct: got %q", got)
	}
	if got := get(sub.ID); got != "Deals / Sale_1" {
		t.Errorf("subfolder: got %q", got)
	}
	if got := get(elsewhere.ID); got != "Other" {
		t.Errorf("elsewhere should not move: got %q", got)
	}
	if got := get(none.ID); got != "" {
		t.Errorf("no folder should not move: got %q", got)
	}

	if err := s.RenameFolder(ctx, p.ID, "Nope", "Else"); err != ErrNotFound {
		t.Errorf("renaming a folder with no tests: got %v, want ErrNotFound", err)
	}
	if err := s.RenameFolder(ctx, p.ID, "", "Else"); err != nil {
		t.Errorf("renaming the empty folder should be a no-op, not an error: %v", err)
	}
}
