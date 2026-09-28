package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
)

func TestRouter(t *testing.T) {
	ui := fstest.MapFS{
		"index.html":    {Data: []byte("<html>app</html>")},
		"assets/app.js": {Data: []byte("js")},
	}
	h := NewRouter(ui)

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
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, c.path, nil))
		if rec.Code != c.wantStatus || !strings.Contains(rec.Body.String(), c.wantBody) {
			t.Errorf("%s: got %d %q, want %d containing %q", c.path, rec.Code, rec.Body.String(), c.wantStatus, c.wantBody)
		}
	}

	rec := httptest.NewRecorder()
	NewRouter(fstest.MapFS{}).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))
	if rec.Code != http.StatusServiceUnavailable {
		t.Errorf("missing UI: got %d, want 503", rec.Code)
	}
}
