package importer

import (
	"context"
	"fmt"
	"strings"

	"github.com/Gudboi-UwU/ndswarm/internal/model"
	"github.com/Gudboi-UwU/ndswarm/internal/project"
)

// Result is what an import created.
type Result struct {
	ProjectID int64     `json:"projectId"`
	Tests     []Created `json:"tests"`
	Warnings  []string  `json:"warnings"`
}

type Created struct {
	ID   int64  `json:"id"`
	Name string `json:"name"`
}

// projectStore is the slice of project.Service that Save needs, so a test can fake a failure
// after a new project is created and check that it gets cleaned up.
type projectStore interface {
	ListEnvironments(ctx context.Context, projectID int64) ([]model.Environment, error)
	ListTests(ctx context.Context, projectID int64) ([]project.TestSummary, error)
	CreateProject(ctx context.Context, p model.Project) (model.Project, error)
	CreateEnvironment(ctx context.Context, e model.Environment) (model.Environment, error)
	CreateTest(ctx context.Context, t model.Test) (model.Test, error)
	DeleteProject(ctx context.Context, id int64) error
}

// Save creates the servers and tests of a checked bundle in projectID, or in a new project named
// newProject when projectID is 0. An existing server with the same name is reused, not overwritten,
// and clashing test names get " (2)", " (3)". A new project is removed again if saving fails.
func Save(ctx context.Context, svc projectStore, b Bundle, projectID int64, newProject string) (res Result, err error) {
	res = Result{Tests: []Created{}, Warnings: []string{}}
	envIDs := map[string]int64{}
	taken := map[string]bool{}
	if projectID != 0 {
		envs, err := svc.ListEnvironments(ctx, projectID)
		if err != nil {
			return res, err
		}
		for _, e := range envs {
			envIDs[strings.ToLower(e.Name)] = e.ID
		}
		tests, err := svc.ListTests(ctx, projectID)
		if err != nil {
			return res, err
		}
		for _, t := range tests {
			taken[strings.ToLower(t.Name)] = true
		}
	} else {
		if strings.TrimSpace(newProject) == "" {
			newProject = b.Project.Name
		}
		// Assign to the named return "err" (not a new local one) so the deferred cleanup below
		// still sees a later failure, such as a server or test that fails to save.
		var p model.Project
		p, err = svc.CreateProject(ctx, model.Project{Name: newProject, Description: b.Project.Description})
		if err != nil {
			return res, err
		}
		projectID = p.ID
		defer func() {
			if err != nil {
				svc.DeleteProject(context.WithoutCancel(ctx), p.ID)
			}
		}()
	}
	res.ProjectID = projectID

	for _, s := range b.Servers {
		if _, ok := envIDs[strings.ToLower(s.Name)]; ok {
			res.Warnings = append(res.Warnings, fmt.Sprintf("The server %q already exists in this project, so the existing one is used and was not changed.", s.Name))
			continue
		}
		e, err := svc.CreateEnvironment(ctx, model.Environment{ProjectID: projectID, Name: s.Name, BaseURL: s.BaseURL,
			Variables: s.Variables, Headers: s.Headers, Auth: s.Auth})
		if err != nil {
			return res, fmt.Errorf("server %q: %w", s.Name, err)
		}
		envIDs[strings.ToLower(s.Name)] = e.ID
	}
	for _, t := range b.Tests {
		mt := t.model()
		mt.ProjectID = projectID
		mt.Name = uniqueName(t.Name, taken)
		if t.Server != "" {
			if id, ok := envIDs[strings.ToLower(t.Server)]; ok {
				mt.EnvironmentID = &id
			} else {
				res.Warnings = append(res.Warnings, fmt.Sprintf("Test %q uses the server %q, which is not in the file or the project. Choose a server in the test.", t.Name, t.Server))
			}
		}
		saved, err := svc.CreateTest(ctx, mt)
		if err != nil {
			return res, fmt.Errorf("test %q: %w", t.Name, err)
		}
		res.Tests = append(res.Tests, Created{saved.ID, saved.Name})
	}
	return res, nil
}

// uniqueName appends " (2)", " (3)" until name is free, and marks it taken.
func uniqueName(name string, taken map[string]bool) string {
	out := name
	for n := 2; taken[strings.ToLower(out)]; n++ {
		suffix := fmt.Sprintf(" (%d)", n)
		r := []rune(name)
		if len(r)+len(suffix) > model.MaxNameLen {
			r = r[:model.MaxNameLen-len(suffix)]
		}
		out = string(r) + suffix
	}
	taken[strings.ToLower(out)] = true
	return out
}
