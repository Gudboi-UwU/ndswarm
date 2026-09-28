package dummy

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestDummy(t *testing.T) {
	srv := httptest.NewServer(Handler())
	defer srv.Close()

	get := func(path, auth string) *http.Response {
		req, _ := http.NewRequest(http.MethodGet, srv.URL+path, nil)
		if auth != "" {
			req.Header.Set("Authorization", auth)
		}
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		return res
	}

	if c := get("/fast", "").StatusCode; c != 200 {
		t.Errorf("/fast: %d", c)
	}

	start := time.Now()
	if c := get("/slow?ms=50", "").StatusCode; c != 200 || time.Since(start) < 50*time.Millisecond {
		t.Errorf("/slow: %d after %v", c, time.Since(start))
	}
	if c := get("/slow?ms=x", "").StatusCode; c != 400 {
		t.Errorf("/slow bad ms: %d", c)
	}

	fails := 0
	for range 2000 {
		if get("/flaky?err=0.2", "").StatusCode == 500 {
			fails++
		}
	}
	if ratio := float64(fails) / 2000; ratio < 0.15 || ratio > 0.25 {
		t.Errorf("/flaky ratio %.3f, want ~0.2", ratio)
	}

	if c := get("/me", "Bearer nope").StatusCode; c != 401 {
		t.Errorf("/me bad token: %d", c)
	}
	res, err := http.Post(srv.URL+"/login", "application/json", strings.NewReader(`{"username":"demo","password":"demo"}`))
	if err != nil || res.StatusCode != 200 {
		t.Fatalf("/login: %v %v", err, res.StatusCode)
	}
	var out struct{ Token string }
	json.NewDecoder(res.Body).Decode(&out)
	res.Body.Close()
	if c := get("/me", "Bearer "+out.Token).StatusCode; c != 200 {
		t.Errorf("/me with token: %d", c)
	}
	res, _ = http.Post(srv.URL+"/login", "application/json", strings.NewReader(`{"username":"demo","password":"x"}`))
	if res.StatusCode != 401 {
		t.Errorf("/login wrong password: %d", res.StatusCode)
	}
}
