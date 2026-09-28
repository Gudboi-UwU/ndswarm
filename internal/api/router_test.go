package api

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/Gudboi-UwU/ndswarm/internal/auth"
	"github.com/Gudboi-UwU/ndswarm/internal/store"
)

func newTestServer(t *testing.T, ui fstest.MapFS) *httptest.Server {
	t.Helper()
	db, err := store.Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	s := &Server{Auth: auth.New(db), Store: db, UI: ui, Version: "test"}
	srv := httptest.NewServer(s.Handler())
	t.Cleanup(func() { srv.Close(); db.Close() })
	return srv
}

func TestStaticAndSPA(t *testing.T) {
	srv := newTestServer(t, fstest.MapFS{
		"index.html":    {Data: []byte("<html>app</html>")},
		"assets/app.js": {Data: []byte("js")},
	})
	cases := []struct {
		path, wantBody string
		wantStatus     int
	}{
		{"/healthz", "ok", 200},
		{"/readyz", "ok", 200},
		{"/assets/app.js", "js", 200},
		{"/", "<html>app</html>", 200},
		{"/runs/42", "<html>app</html>", 200}, // client-side route
		{"/api/v1/nope", `"code":"not_found"`, 404},
	}
	for _, c := range cases {
		res, err := http.Get(srv.URL + c.path)
		if err != nil {
			t.Fatal(err)
		}
		body, _ := io.ReadAll(res.Body)
		res.Body.Close()
		if res.StatusCode != c.wantStatus || !strings.Contains(string(body), c.wantBody) {
			t.Errorf("%s: got %d %q, want %d containing %q", c.path, res.StatusCode, body, c.wantStatus, c.wantBody)
		}
	}

	res, _ := http.Get(newTestServer(t, fstest.MapFS{}).URL + "/")
	if res.StatusCode != http.StatusServiceUnavailable {
		t.Errorf("missing UI: got %d, want 503", res.StatusCode)
	}
}

// client is one browser: its own cookie jar.
type client struct {
	t    *testing.T
	base string
	http *http.Client
}

func newClient(t *testing.T, base string) *client {
	jar, _ := cookiejar.New(nil)
	return &client{t, base, &http.Client{Jar: jar}}
}

func (c *client) do(method, path, body string) (int, map[string]any) {
	c.t.Helper()
	req, _ := http.NewRequest(method, c.base+"/api/v1"+path, strings.NewReader(body))
	req.Header.Set("X-Requested-With", "ndswarm")
	res, err := c.http.Do(req)
	if err != nil {
		c.t.Fatal(err)
	}
	defer res.Body.Close()
	var out map[string]any
	raw, _ := io.ReadAll(res.Body)
	json.Unmarshal(raw, &out)
	return res.StatusCode, out
}

func (c *client) expect(method, path, body string, want int) map[string]any {
	c.t.Helper()
	got, out := c.do(method, path, body)
	if got != want {
		c.t.Errorf("%s %s: got %d %v, want %d", method, path, got, out, want)
	}
	return out
}

// TestAuthFlow is the M1 acceptance scenario: setup, login, a viewer cannot edit, guests can view.
func TestAuthFlow(t *testing.T) {
	srv := newTestServer(t, fstest.MapFS{})
	admin, viewer, guest := newClient(t, srv.URL), newClient(t, srv.URL), newClient(t, srv.URL)

	me := guest.expect("GET", "/auth/me", "", 200)
	if me["setupRequired"] != true || me["user"] != nil {
		t.Errorf("fresh me: %v", me)
	}
	guest.expect("GET", "/system", "", 401)

	out := admin.expect("POST", "/auth/setup", `{"username":"ad","password":"x"}`, 400)
	if details, _ := out["error"].(map[string]any)["details"].([]any); len(details) != 2 {
		t.Errorf("validation details: %v", out)
	}
	admin.expect("POST", "/auth/setup", `{"username":"admin","password":"password1"}`, 201)
	guest.expect("POST", "/auth/setup", `{"username":"evil","password":"password1"}`, 409)
	if me := admin.expect("GET", "/auth/me", "", 200); me["can"].(map[string]any)["admin"] != true {
		t.Errorf("admin me: %v", me)
	}

	// CSRF header is mandatory for writes.
	req, _ := http.NewRequest("POST", srv.URL+"/api/v1/users", strings.NewReader(`{}`))
	if res, _ := admin.http.Do(req); res.StatusCode != 403 {
		t.Errorf("write without CSRF header: %d", res.StatusCode)
	}

	admin.expect("POST", "/users", `{"username":"vera","password":"password1","role":"viewer"}`, 201)
	admin.expect("POST", "/users", `{"username":"vera","password":"password1","role":"viewer"}`, 409)
	admin.expect("POST", "/users", `{"username":"x","password":"password1","role":"viewer","extra":1}`, 400)

	viewer.expect("POST", "/auth/login", `{"username":"vera","password":"nope-nope"}`, 401)
	viewer.expect("POST", "/auth/login", `{"username":"vera","password":"password1"}`, 200)
	me = viewer.expect("GET", "/auth/me", "", 200)
	if can := me["can"].(map[string]any); can["view"] != true || can["edit"] != false || can["run"] != false {
		t.Errorf("viewer can: %v", can)
	}
	viewer.expect("GET", "/system", "", 200)
	viewer.expect("GET", "/users", "", 403)
	viewer.expect("PATCH", "/settings", `{"guestMode":"run"}`, 403)

	// Guest mode: off by default, view after admin enables it.
	admin.expect("PATCH", "/settings", `{"guestMode":"public"}`, 400)
	if out := admin.expect("PATCH", "/settings", `{"guestMode":"view"}`, 200); out["guestMode"] != "view" {
		t.Errorf("settings: %v", out)
	}
	guest.expect("GET", "/system", "", 200)
	guest.expect("GET", "/users", "", 401)
	if me := guest.expect("GET", "/auth/me", "", 200); me["can"].(map[string]any)["run"] != false {
		t.Errorf("guest view can: %v", me)
	}

	// Logout kills the session server-side.
	viewer.expect("POST", "/auth/logout", "", 204)
	if me := viewer.expect("GET", "/auth/me", "", 200); me["user"] != nil {
		t.Errorf("after logout: %v", me)
	}
}
