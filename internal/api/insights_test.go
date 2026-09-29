package api

import (
	"encoding/csv"
	"fmt"
	"io"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/Gudboi-UwU/ndswarm/internal/dummy"
)

func TestRunInsights(t *testing.T) {
	srv := newTestServer(t, fstest.MapFS{})
	target := httptest.NewServer(dummy.Handler())
	defer target.Close()
	admin := newClient(t, srv.URL)
	admin.expect("POST", "/auth/setup", `{"username":"admin","password":"password1"}`, 201)
	p := admin.expect("POST", "/projects", `{"name":"P"}`, 201)
	e := admin.expect("POST", fmt.Sprintf("/projects/%v/environments", p["id"]), fmt.Sprintf(`{"name":"e","baseUrl":%q}`, target.URL), 201)
	test := admin.expect("POST", fmt.Sprintf("/projects/%v/tests", p["id"]), fmt.Sprintf(`{"name":"T","environmentId":%v,
		"flows":[{"id":"f","name":"Flaky","enabled":true,"weight":1,"steps":[{"id":"s","name":"Flaky","enabled":true,"method":"GET","url":"/flaky?err=0.5",
		"body":{"type":"none"},"timeoutMs":5000,"followRedirects":true}]}],
		"load":{"stages":[{"durationSec":1,"target":4},{"durationSec":11,"target":4}]},
		"settings":{"keepAlive":true,"http2":true,"logSamplePct":100,"captureBodies":true}}`, e["id"]), 201)

	// Run with a 500 error half the time; errors are forced through preflight by force.
	run := admin.expect("POST", fmt.Sprintf("/tests/%v/runs", test["id"]), `{"force":true}`, 201)
	id := run["id"]
	deadline := time.Now().Add(30 * time.Second)
	for admin.expect("GET", fmt.Sprintf("/runs/%v", id), "", 200)["status"] == "running" {
		if time.Now().After(deadline) {
			t.Fatal("run did not finish")
		}
		time.Sleep(200 * time.Millisecond)
	}
	final := admin.expect("GET", fmt.Sprintf("/runs/%v", id), "", 200)
	summary := final["summary"].(map[string]any)
	total := summary["total"].(map[string]any)
	if summary["droppedLogs"].(float64) == 0 {
		t.Errorf("thousands of requests over 12s must exceed the log caps: %v", summary)
	}

	// Logs: caps hold (<= 50 errors + 20 samples + 1 slowest per second), filters and cursor work.
	page := admin.expect("GET", fmt.Sprintf("/runs/%v/logs?limit=500", id), "", 200)
	items := page["items"].([]any)
	if len(items) == 0 || len(items) > 500 {
		t.Fatalf("logs page %d", len(items))
	}
	var logged float64
	for next := page["next"]; next != nil; {
		p := admin.expect("GET", fmt.Sprintf("/runs/%v/logs?limit=500&cursor=%v", id, next), "", 200)
		logged += float64(len(p["items"].([]any)))
		next = p["next"]
	}
	logged += float64(len(items))
	if logged > 13*71 || logged >= total["count"].(float64) {
		t.Errorf("%v logged of %v requests: caps not applied", logged, total["count"])
	}
	errs := admin.expect("GET", fmt.Sprintf("/runs/%v/logs?category=http_5xx&limit=5", id), "", 200)["items"].([]any)
	if len(errs) != 5 || errs[0].(map[string]any)["status"].(float64) != 500 {
		t.Errorf("category filter %v", errs)
	}
	first := errs[0].(map[string]any)
	detail := admin.expect("GET", fmt.Sprintf("/runs/%v/logs/%v", id, first["id"]), "", 200)
	if detail["request"].(map[string]any)["method"] != "GET" || detail["response"].(map[string]any)["status"].(float64) != 500 {
		t.Errorf("detail %v", detail)
	}

	// Errors: groups count every error, not just logged ones.
	ev := admin.expect("GET", fmt.Sprintf("/runs/%v/errors", id), "", 200)
	g := ev["groups"].([]any)[0].(map[string]any)
	if g["message"] != "HTTP 500 Internal Server Error" || g["count"].(float64) != total["err"].(float64) || g["exampleLogId"] == nil {
		t.Errorf("error group %v (total err %v)", g, total["err"])
	}

	// Summary by 10 s interval with exact percentiles, and by status.
	res, _ := admin.http.Get(fmt.Sprintf("%s/api/v1/runs/%v/summary?by=interval&interval=10", srv.URL, id))
	body, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if !strings.Contains(string(body), `"fromSec":0,"toSec":10`) || !strings.Contains(string(body), `"fromSec":10,"toSec":20`) || strings.Contains(string(body), `"p95":0,`) {
		t.Errorf("intervals %s", body)
	}
	for size, wantExact := range map[int]bool{5: true, 15: true, 7: false} {
		res, _ := admin.http.Get(fmt.Sprintf("%s/api/v1/runs/%v/summary?by=interval&interval=%d", srv.URL, id, size))
		b, _ := io.ReadAll(res.Body)
		res.Body.Close()
		if !strings.Contains(string(b), fmt.Sprintf(`"fromSec":0,"toSec":%d`, size)) || strings.Contains(string(b), fmt.Sprintf(`"exact":%v`, !wantExact)) {
			t.Errorf("interval %d: %s", size, b)
		}
	}
	res, _ = admin.http.Get(fmt.Sprintf("%s/api/v1/runs/%v/summary?by=status", srv.URL, id))
	body, _ = io.ReadAll(res.Body)
	res.Body.Close()
	if !strings.Contains(string(body), `"code":"500"`) || !strings.Contains(string(body), `"code":"200"`) {
		t.Errorf("statuses %s", body)
	}

	// Exports.
	for _, what := range []string{"summary", "timeseries", "logs"} {
		res, _ := admin.http.Get(fmt.Sprintf("%s/api/v1/runs/%v/export?what=%s&format=csv", srv.URL, id, what))
		recs, err := csv.NewReader(res.Body).ReadAll()
		res.Body.Close()
		if err != nil || len(recs) < 2 || !strings.Contains(res.Header.Get("Content-Disposition"), what+".csv") {
			t.Errorf("export %s: %v rows=%d %s", what, err, len(recs), res.Header.Get("Content-Disposition"))
		}
	}
	res, _ = admin.http.Get(fmt.Sprintf("%s/api/v1/runs/%v/export?what=summary&format=json", srv.URL, id))
	body, _ = io.ReadAll(res.Body)
	res.Body.Close()
	if !strings.Contains(string(body), `"endpoint":"All"`) {
		t.Errorf("json export %s", body)
	}

	// Dashboard and history.
	d := admin.expect("GET", "/dashboard", "", 200)
	if d["week"].(map[string]any)["runs"].(float64) != 1 || len(d["recent"].([]any)) != 1 {
		t.Errorf("dashboard %v", d)
	}
	admin.expect("GET", "/runs?status=finished", "", 200)

	// Allowlist: the admin limits targets; Try is refused for other hosts.
	admin.expect("PATCH", "/settings", `{"targetAllowlist":["api.example.com"]}`, 200)
	tr := admin.expect("POST", "/tools/try", fmt.Sprintf(`{"step":{"id":"s","name":"x","method":"GET","url":%q}}`, target.URL+"/fast"), 200)
	if e := tr["error"].(map[string]any); !strings.Contains(e["message"].(string), "allowlist") {
		t.Errorf("allowlist not enforced: %v", tr)
	}
	admin.expect("PATCH", "/settings", `{"targetAllowlist":["bad host"]}`, 400)

	admin.expect("DELETE", fmt.Sprintf("/runs/%v", id), "", 204)
	admin.expect("GET", fmt.Sprintf("/runs/%v/logs", id), "", 404)
}
