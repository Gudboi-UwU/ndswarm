// Package importer converts tests to and from files: the native ndswarm format and Postman collections.
//
// Every import produces a Bundle, which is checked in one place before anything is saved.
package importer

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"sigs.k8s.io/yaml"

	"github.com/Gudboi-UwU/ndswarm/internal/model"
)

// MaxSize is the largest file accepted for import.
const MaxSize = 20 << 20

// Bundle is the portable form of a project, and what a native file holds.
type Bundle struct {
	Format     string      `json:"format"`
	Version    int         `json:"version"`
	ExportedAt string      `json:"exportedAt,omitempty"`
	Project    ProjectInfo `json:"project"`
	Servers    []Server    `json:"servers"`
	Tests      []Test      `json:"tests"`
}

type ProjectInfo struct {
	Name        string `json:"name"`
	Description string `json:"description"`
}

// Server is an environment without ids. Secret values are always empty in files.
type Server struct {
	Name      string         `json:"name"`
	BaseURL   string         `json:"baseUrl"`
	Variables []model.EnvVar `json:"variables"`
	Headers   []model.EnvVar `json:"headers"`
	Auth      model.Auth     `json:"auth"`
}

// Test is a test without ids; Server names one of the bundle's servers (or an existing one).
type Test struct {
	Name        string         `json:"name"`
	Description string         `json:"description"`
	Server      string         `json:"server"`
	Flows       []model.Flow   `json:"flows"`
	Load        model.Load     `json:"load"`
	Settings    model.Settings `json:"settings"`
}

// FromProject builds a native bundle. Every secret value is emptied.
func FromProject(p model.Project, envs []model.Environment, tests []model.Test) Bundle {
	b := Bundle{Format: "ndswarm", Version: 1, ExportedAt: time.Now().UTC().Format(time.RFC3339),
		Project: ProjectInfo{p.Name, p.Description}, Servers: []Server{}, Tests: []Test{}}
	names := map[int64]string{}
	for _, e := range envs {
		e.Variables, e.Headers = slices.Clone(e.Variables), slices.Clone(e.Headers) // do not touch the caller's values
		e.MapSecrets(func(string) (string, error) { return "", nil })
		names[e.ID] = e.Name
		b.Servers = append(b.Servers, Server{e.Name, e.BaseURL, e.Variables, e.Headers, e.Auth})
	}
	for _, t := range tests {
		server := ""
		if t.EnvironmentID != nil {
			server = names[*t.EnvironmentID]
		}
		b.Tests = append(b.Tests, Test{t.Name, t.Description, server, t.Flows, t.Load, t.Settings})
	}
	return b
}

// Marshal encodes the bundle as "json" (default) or "yaml".
func (b Bundle) Marshal(typ string) ([]byte, error) {
	out, err := marshal(b)
	if err != nil || typ != "yaml" {
		return out, err
	}
	return yaml.JSONToYAML(out)
}

// Decode reads an uploaded file (JSON or YAML) and an optional Postman environment file.
// It returns a checked bundle and warnings about what could not be imported.
func Decode(content, environment string) (Bundle, []string, error) {
	var b Bundle
	if len(content)+len(environment) > MaxSize {
		return b, nil, errors.New("the file is larger than 20 MB")
	}
	data, err := toJSON(content)
	if err != nil {
		return b, nil, err
	}
	var probe struct {
		Format string `json:"format"`
		Info   struct {
			Schema string `json:"schema"`
		} `json:"info"`
		Values json.RawMessage `json:"values"`
		Item   json.RawMessage `json:"item"`
	}
	if json.Unmarshal(data, &probe) != nil {
		return b, nil, errors.New("this file is not a JSON object")
	}
	var warns []string
	switch {
	case probe.Format == "ndswarm":
		b, err = decodeNative(data)
	case strings.Contains(probe.Info.Schema, "collection") || (probe.Info.Schema == "" && probe.Item != nil):
		var env []byte
		if strings.TrimSpace(environment) != "" {
			if env, err = toJSON(environment); err != nil {
				return b, nil, fmt.Errorf("environment file: %w", err)
			}
		}
		b, warns, err = decodePostman(data, env)
	case probe.Values != nil && probe.Item == nil:
		err = errors.New("this is a Postman environment file. Choose the collection file first, then add this one as the environment")
	default:
		err = errors.New("this file is not an ndswarm export or a Postman collection (v2.0 or v2.1)")
	}
	if err != nil {
		return b, nil, err
	}
	more, err := b.check()
	return b, append(warns, more...), err
}

func toJSON(s string) ([]byte, error) {
	s = strings.TrimPrefix(strings.TrimSpace(s), "\ufeff")
	if s == "" {
		return nil, errors.New("the file is empty")
	}
	if strings.HasPrefix(s, "{") || strings.HasPrefix(s, "[") {
		if !json.Valid([]byte(s)) {
			return nil, errors.New("the file is not valid JSON")
		}
		return []byte(s), nil
	}
	out, err := yaml.YAMLToJSON([]byte(s))
	if err != nil {
		return nil, errors.New("the file is neither valid JSON nor valid YAML")
	}
	return out, nil
}

func decodeNative(data []byte) (Bundle, error) {
	var b Bundle
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&b); err != nil {
		return b, fmt.Errorf("this ndswarm file is damaged: %v", err)
	}
	if b.Version != 1 {
		return b, fmt.Errorf("this ndswarm file has version %d; this server reads version 1", b.Version)
	}
	for i := range b.Tests {
		if b.Tests[i].Settings == (model.Settings{}) {
			b.Tests[i].Settings = model.DefaultSettings
		}
	}
	return b, nil
}

// check normalizes and validates everything so a save cannot fail half-way on bad input.
// Requests that fail validation are dropped with a warning; a server or test that fails is an error.
func (b *Bundle) check() ([]string, error) {
	var warns []string
	var problems []string
	b.Project.Name = clip(b.Project.Name)
	if b.Project.Name == "" {
		b.Project.Name = "Imported project"
	}
	for i := range b.Servers {
		s := &b.Servers[i]
		s.Name = clip(s.Name)
		e := model.Environment{Name: s.Name, BaseURL: s.BaseURL, Variables: s.Variables, Headers: s.Headers, Auth: s.Auth}
		e.Normalize()
		if a := e.Auth; (a.Type == "bearer" && a.Token == "") || (a.Type == "apiKey" && a.Value == "") {
			warns = append(warns, fmt.Sprintf("Server %q: the %s sign-in has no key in the file, so it was turned off. Set it again in the server settings.", s.Name, a.Type))
			e.Auth = model.Auth{Type: "none"}
		}
		empty := 0
		for _, v := range append(append([]model.EnvVar{}, e.Variables...), e.Headers...) {
			if v.Secret && v.Value == "" {
				empty++
			}
		}
		if empty > 0 {
			warns = append(warns, fmt.Sprintf("Server %q: %d secret value(s) are empty because secrets are never exported. Fill them in before running.", s.Name, empty))
		}
		if err := e.Validate(); err != nil {
			problems = append(problems, fmt.Sprintf("Server %q: %s", s.Name, details(err)))
		}
		*s = Server{e.Name, e.BaseURL, e.Variables, e.Headers, e.Auth}
	}
	for i := range b.Tests {
		t := &b.Tests[i]
		t.Name = clip(t.Name)
		flows := []model.Flow{}
		for _, f := range t.Flows {
			one := model.Test{Name: "x", Flows: []model.Flow{f}}
			one.Normalize()
			if err := one.Validate(); err != nil {
				warns = append(warns, fmt.Sprintf("Test %q, request %q was skipped: %s", t.Name, f.Name, details(err)))
				continue
			}
			flows = append(flows, one.Flows[0])
		}
		t.Flows = flows
		mt := t.model()
		mt.Normalize()
		if err := mt.Validate(); err != nil {
			problems = append(problems, fmt.Sprintf("Test %q: %s", t.Name, details(err)))
		}
		t.Flows, t.Load, t.Settings = mt.Flows, mt.Load, mt.Settings
	}
	if len(problems) > 0 {
		return warns, errors.New("the file cannot be imported. " + strings.Join(problems, " "))
	}
	return warns, nil
}

func (t Test) model() model.Test {
	return model.Test{Name: t.Name, Description: t.Description, Flows: t.Flows, Load: t.Load, Settings: t.Settings}
}

func details(err error) string {
	var v model.ValidationError
	if !errors.As(err, &v) {
		return err.Error()
	}
	msgs := make([]string, len(v))
	for i, e := range v {
		msgs[i] = e.Path + ": " + e.Message
	}
	return strings.Join(msgs, "; ")
}

// clip trims a name and cuts it to the model's limit.
func clip(s string) string {
	s = strings.TrimSpace(s)
	if utf8.RuneCountInString(s) > model.MaxNameLen {
		s = strings.TrimSpace(string([]rune(s)[:model.MaxNameLen]))
	}
	return s
}

// newID returns a short random hex id for flows, steps and variants.
func newID() string {
	b := make([]byte, 6)
	rand.Read(b)
	return hex.EncodeToString(b)
}

// marshal writes indented JSON without escaping <, > and & (templates and URLs use them).
func marshal(v any) ([]byte, error) {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	enc.SetIndent("", "  ")
	err := enc.Encode(v)
	return buf.Bytes(), err
}
