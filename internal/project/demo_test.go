package project

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/Gudboi-UwU/ndswarm/internal/secret"
	"github.com/Gudboi-UwU/ndswarm/internal/store"
)

func TestSeedDemo(t *testing.T) {
	ctx := context.Background()
	db, err := store.Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	box, _ := secret.New(make([]byte, 32))
	s := New(db, box)

	if seeded, err := s.SeedDemo(ctx, "http://dummytarget:8090"); err != nil || !seeded {
		t.Fatalf("first seed: %v %v", seeded, err)
	}
	projects, _ := s.ListProjects(ctx)
	if len(projects) != 1 || projects[0].TestCount != 1 {
		t.Fatalf("projects %+v", projects)
	}
	tests, _ := s.ListTests(ctx, projects[0].ID)
	test, err := s.GetTest(ctx, tests[0].ID)
	if err != nil || test.Validate() != nil || len(test.Flows) != 5 {
		t.Errorf("demo test invalid: %v %v", err, test.Validate())
	}
	s.DeleteProject(ctx, projects[0].ID)
	if seeded, _ := s.SeedDemo(ctx, "x"); seeded {
		t.Error("demo seeded twice")
	}
}
