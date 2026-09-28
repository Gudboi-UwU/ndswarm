package engine

import (
	"context"
	"encoding/json"
	"errors"
	"mime"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/Gudboi-UwU/ndswarm/internal/dummy"
	"github.com/Gudboi-UwU/ndswarm/internal/model"
	"github.com/Gudboi-UwU/ndswarm/internal/tmpl"
)

func step(body model.Body) model.Step {
	s := model.Step{ID: "s", Name: "Create", Enabled: true, Method: "POST", URL: "/orders", Body: body,
		Query:   []model.KV{{Key: "q", Value: "a b&c", Enabled: true}, {Key: "off", Value: "x", Enabled: false}},
		Headers: []model.KV{{Key: "X-Trace", Value: "{{seq}}", Enabled: true}}}
	return s
}

func env() *model.Environment {
	return &model.Environment{Name: "dev", BaseURL: "http://api.test/v1/",
		Variables: []model.EnvVar{{Key: "tok", Value: "t-{{int 7 7}}"}},
		Headers:   []model.EnvVar{{Key: "X-Env", Value: "dev"}, {Key: "Authorization", Value: "overridden by auth"}},
		Auth:      model.Auth{Type: "bearer", Token: `{{var "tok"}}`}}
}

func render(t *testing.T, s model.Step, e *model.Environment) *Request {
	t.Helper()
	cs, err := Compile(s, e)
	if err != nil {
		t.Fatal(err)
	}
	c := tmpl.NewCtx(1, nil, nil)
	if _, err := EnvVars(e, c); err != nil {
		t.Fatal(err)
	}
	r, err := cs.Render(c, 0)
	if err != nil {
		t.Fatal(err)
	}
	return r
}

func TestRenderJSONFields(t *testing.T) {
	yes, no := true, false
	s := step(model.Body{Type: "json", Variants: []model.Variant{{ID: "v", Name: "full", Enabled: true, Mode: "fields", Fields: []model.Field{
		{Key: "name", Type: "string", Value: "{{int 5 5}}"}, // a number rendered into a string field stays a string
		{Key: "age", Type: "integer", Value: "{{int 30 30}}"},
		{Key: "score", Type: "number", Value: " 1.50 "},
		{Key: "vip", Type: "boolean", Value: "{{bool 1}}"},
		{Key: "gone", Type: "string", Value: "x", Enabled: &no},
		{Key: "note", Type: "null"},
		{Key: "addr", Type: "object", Enabled: &yes, Children: []model.Field{{Key: "city", Type: "string", Value: "Bandung"}}},
		{Key: "tags", Type: "array", ArrayLen: &model.MinMax{Min: 2, Max: 2}, Children: []model.Field{{Type: "string", Value: "t"}}},
	}}}})
	r := render(t, s, env())

	if got, want := string(r.Body), `{"name":"5","age":30,"score":1.5,"vip":true,"note":null,"addr":{"city":"Bandung"},"tags":["t","t"]}`; got != want {
		t.Errorf("body\n got %s\nwant %s", got, want)
	}
	if r.URL != "http://api.test/v1/orders?q=a+b%26c" {
		t.Errorf("url %s", r.URL)
	}
	h := r.Header
	if h.Get("Authorization") != "Bearer t-7" || h.Get("X-Env") != "dev" || h.Get("X-Trace") != "1" || h.Get("Content-Type") != "application/json" {
		t.Errorf("headers %v", h)
	}
}

func TestRenderOtherBodies(t *testing.T) {
	fields := []model.Field{{Key: "user", Type: "string", Value: "vera"}, {Key: "n", Type: "integer", Value: "3"}}

	form := render(t, step(model.Body{Type: "form", Variants: []model.Variant{{ID: "v", Name: "a", Enabled: true, Mode: "fields", Fields: fields}}}), nil2())
	if v, _ := url.ParseQuery(string(form.Body)); v.Get("user") != "vera" || v.Get("n") != "3" || form.Header.Get("Content-Type") != "application/x-www-form-urlencoded" {
		t.Errorf("form %s %v", form.Body, form.Header)
	}

	mp := render(t, step(model.Body{Type: "multipart", Variants: []model.Variant{{ID: "v", Name: "a", Enabled: true, Mode: "fields", Fields: fields}}}), nil2())
	_, params, _ := mime.ParseMediaType(mp.Header.Get("Content-Type"))
	f, err := multipart.NewReader(strings.NewReader(string(mp.Body)), params["boundary"]).ReadForm(1 << 20)
	if err != nil || f.Value["user"][0] != "vera" {
		t.Errorf("multipart %v %v", err, f)
	}

	raw := render(t, step(model.Body{Type: "json", Variants: []model.Variant{
		{ID: "off", Name: "off", Enabled: false, Mode: "raw", Raw: "nope"},
		{ID: "v", Name: "raw", Enabled: true, Mode: "raw", Raw: `{"name": {{q "a\"b"}}}`},
	}}), nil2())
	var decoded map[string]string
	if json.Unmarshal(raw.Body, &decoded) != nil || decoded["name"] != `a"b` || raw.Variant != "raw" {
		t.Errorf("raw %s", raw.Body)
	}
}

func nil2() *model.Environment { return &model.Environment{BaseURL: "http://h"} }

func TestRenderErrors(t *testing.T) {
	bad := step(model.Body{Type: "json", Variants: []model.Variant{{ID: "v", Name: "a", Enabled: true, Mode: "fields",
		Fields: []model.Field{{Key: "age", Type: "integer", Value: "abc"}}}}})
	cs, _ := Compile(bad, nil2())
	_, err := cs.Render(tmpl.NewCtx(1, nil, nil), 0)
	var te TemplateError
	if !errors.As(err, &te) || !strings.Contains(err.Error(), `"abc" is not an integer`) {
		t.Errorf("typed error: %v", err)
	}

	rel := step(model.Body{Type: "none"})
	cs, _ = Compile(rel, nil)
	if _, err := cs.Render(tmpl.NewCtx(1, nil, nil), 0); err == nil || !strings.Contains(err.Error(), "no base URL") {
		t.Errorf("relative without base: %v", err)
	}
	if _, err := Compile(model.Step{Method: "GET", URL: "{{nope}}"}, nil); err == nil {
		t.Error("bad template compiled")
	}
}

func TestSend(t *testing.T) {
	srv := httptest.NewServer(dummy.Handler())
	defer srv.Close()
	client := Client(NewTransport(ClientOptions{}), true)
	c := tmpl.NewCtx(1, nil, nil)

	s := model.Step{Method: "POST", URL: srv.URL + "/echo", Body: model.Body{Type: "raw", Variants: []model.Variant{{ID: "v", Name: "a", Enabled: true, Mode: "raw", Raw: "hello"}}}}
	cs, _ := Compile(s, nil)
	r, _ := cs.Render(c, 0)
	res := Send(context.Background(), client, r, 5*time.Second)
	if res.Err != nil || res.Status != 200 || !strings.Contains(string(res.Body), `"body":"hello"`) || res.BytesOut != 5 || res.Timing.Total <= 0 {
		t.Errorf("echo: %+v %s", res, res.Body)
	}

	slow, _ := Compile(model.Step{Method: "GET", URL: srv.URL + "/slow?ms=500"}, nil)
	r, _ = slow.Render(c, 0)
	if res := Send(context.Background(), client, r, 50*time.Millisecond); res.Category != "timeout" {
		t.Errorf("timeout category: %q %v", res.Category, res.Err)
	}

	for _, target := range []string{"http://169.254.169.254/latest/meta-data", "http://[fe80::1]/"} {
		meta, _ := Compile(model.Step{Method: "GET", URL: target}, nil)
		r, _ = meta.Render(c, 0)
		if res := Send(context.Background(), client, r, time.Second); !errors.Is(res.Err, ErrBlockedTarget) {
			t.Errorf("%s not blocked: %v", target, res.Err)
		}
	}

	refused, _ := Compile(model.Step{Method: "GET", URL: "http://127.0.0.1:1/"}, nil)
	r, _ = refused.Render(c, 0)
	if res := Send(context.Background(), client, r, time.Second); res.Category != "connection" {
		t.Errorf("refused: %q %v", res.Category, res.Err)
	}

	// Redirects: followed by default, returned as-is when disabled.
	redirect := httptest.NewServer(http.RedirectHandler(srv.URL+"/fast", http.StatusFound))
	defer redirect.Close()
	rd, _ := Compile(model.Step{Method: "GET", URL: redirect.URL}, nil)
	r, _ = rd.Render(c, 0)
	if res := Send(context.Background(), Client(client.Transport, false), r, time.Second); res.Status != 302 {
		t.Errorf("no-follow status %d", res.Status)
	}
	if res := Send(context.Background(), client, r, time.Second); res.Status != 200 {
		t.Errorf("follow status %d", res.Status)
	}
}

func TestGuardAllowlist(t *testing.T) {
	g := Guard{Allow: []string{"api.example.com", "*.internal.test"}}
	for host, want := range map[string]bool{"api.example.com": true, "API.example.com.": true, "a.internal.test": true, "internal.test": false, "evil.com": false, "127.0.0.1": false} {
		if got := g.allows(host); got != want {
			t.Errorf("allows(%q) = %v, want %v", host, got, want)
		}
	}
	srv := httptest.NewServer(dummy.Handler())
	defer srv.Close()
	cs, _ := Compile(model.Step{Method: "GET", URL: srv.URL + "/fast"}, nil)
	r, _ := cs.Render(tmpl.NewCtx(1, nil, nil), 0)
	res := Send(context.Background(), Client(NewTransport(ClientOptions{Guard: g}), true), r, time.Second)
	if !errors.Is(res.Err, ErrNotAllowed) {
		t.Errorf("host outside allowlist reached: %v", res.Err)
	}
}
