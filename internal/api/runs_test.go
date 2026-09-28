package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/coder/websocket"

	"github.com/Gudboi-UwU/ndswarm/internal/dummy"
)

func TestRunLifecycle(t *testing.T) {
	srv := newTestServer(t, fstest.MapFS{})
	target := httptest.NewServer(dummy.Handler())
	defer target.Close()
	admin := newClient(t, srv.URL)
	admin.expect("POST", "/auth/setup", `{"username":"admin","password":"password1"}`, 201)
	p := admin.expect("POST", "/projects", `{"name":"P"}`, 201)
	e := admin.expect("POST", fmt.Sprintf("/projects/%v/environments", p["id"]), fmt.Sprintf(`{"name":"e","baseUrl":%q}`, target.URL), 201)

	flow := func(name, url string) string {
		return fmt.Sprintf(`{"id":%q,"name":%q,"enabled":true,"weight":1,"steps":[{"id":%q,"name":%q,"enabled":true,"method":"GET","url":%q,
			"body":{"type":"none"},"timeoutMs":5000,"followRedirects":true}]}`, name, name, name, name, url)
	}
	mkTest := func(flows string, secs int) float64 {
		body := fmt.Sprintf(`{"name":"T","environmentId":%v,"flows":[%s],"load":{"stages":[{"durationSec":1,"target":3},{"durationSec":%d,"target":3}]}}`, e["id"], flows, secs)
		return admin.expect("POST", fmt.Sprintf("/projects/%v/tests", p["id"]), body, 201)["id"].(float64)
	}

	// Preflight: a 404 endpoint is a warning; start refuses until forced.
	bad := mkTest(flow("missing", "/nope"), 1)
	pf := admin.expect("POST", fmt.Sprintf("/tests/%v/preflight", bad), "", 200)
	if w := pf["warnings"].([]any); len(w) != 1 || !strings.Contains(w[0].(string), "404") {
		t.Errorf("preflight warnings: %v", pf)
	}
	out := admin.expect("POST", fmt.Sprintf("/tests/%v/runs", bad), `{}`, 422)
	if out["preflight"] == nil {
		t.Errorf("422 without preflight: %v", out)
	}
	broken := mkTest(flow("tmpl", "/fast?x={{int 9 1}}"), 1)
	out = admin.expect("POST", fmt.Sprintf("/tests/%v/runs", broken), `{"force":true}`, 422)
	if errs := out["preflight"].(map[string]any)["errors"].([]any); len(errs) != 1 || !strings.Contains(errs[0].(string), "min must be <= max") {
		t.Errorf("render error must block even with force: %v", out)
	}

	// Start, watch ticks over WebSocket, reject a second start, stop.
	good := mkTest(flow("fast", "/fast"), 60)
	run := admin.expect("POST", fmt.Sprintf("/tests/%v/runs", good), `{}`, 201)
	runID := int64(run["id"].(float64))

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/api/v1/ws"
	conn, _, err := websocket.Dial(ctx, wsURL, &websocket.DialOptions{HTTPClient: admin.http})
	if err != nil {
		t.Fatal(err)
	}
	defer conn.CloseNow()
	conn.Write(ctx, websocket.MessageText, []byte(fmt.Sprintf(`{"type":"subscribe","runId":%d}`, runID)))
	var tick struct {
		Type  string `json:"type"`
		VUs   int    `json:"vus"`
		Total struct {
			Count int64 `json:"count"`
		} `json:"total"`
	}
	for tick.Total.Count == 0 {
		_, data, err := conn.Read(ctx)
		if err != nil {
			t.Fatalf("no tick: %v", err)
		}
		json.Unmarshal(data, &tick)
	}
	if tick.Type != "run.tick" || tick.VUs == 0 {
		t.Errorf("tick %+v", tick)
	}

	out = admin.expect("POST", fmt.Sprintf("/tests/%v/runs", good), `{}`, 409)
	if int64(out["runId"].(float64)) != runID {
		t.Errorf("409 must point at the active run: %v", out)
	}
	if a := admin.expect("GET", "/runs/active", "", 200); int64(a["id"].(float64)) != runID {
		t.Errorf("active %v", a)
	}
	live := admin.expect("GET", fmt.Sprintf("/runs/%d", runID), "", 200)
	if live["status"] != "running" || live["live"] == nil {
		t.Errorf("live run %v", live)
	}

	admin.expect("POST", fmt.Sprintf("/runs/%d/stop", runID), "", 202)
	var status struct{ Type, Status, EndReason string }
	for status.Type != "run.status" || status.Status == "stopping" {
		_, data, err := conn.Read(ctx)
		if err != nil {
			t.Fatalf("no final status: %v", err)
		}
		json.Unmarshal(data, &status)
	}
	if status.Status != "aborted" || status.EndReason != "stopped by admin" {
		t.Errorf("final status %+v", status)
	}
	final := admin.expect("GET", fmt.Sprintf("/runs/%d", runID), "", 200)
	if final["status"] != "aborted" || final["summary"].(map[string]any)["total"].(map[string]any)["count"].(float64) == 0 {
		t.Errorf("final run %v", final)
	}
	var series []map[string]any
	res, _ := admin.http.Get(srv.URL + fmt.Sprintf("/api/v1/runs/%d/timeseries", runID))
	json.NewDecoder(res.Body).Decode(&series)
	res.Body.Close()
	if len(series) == 0 || series[0]["count"].(float64) == 0 {
		t.Errorf("timeseries %v", series)
	}
	admin.expect("POST", fmt.Sprintf("/runs/%d/stop", runID), "", 409)
	if a := admin.expect("GET", "/runs/active", "", 200); a["id"] != nil {
		t.Errorf("still active %v", a)
	}

	// A short run finishes on its own with a pass verdict.
	short := mkTest(flow("fast", "/fast"), 1)
	run = admin.expect("POST", fmt.Sprintf("/tests/%v/runs", short), `{}`, 201)
	deadline := time.Now().Add(10 * time.Second)
	for {
		r := admin.expect("GET", fmt.Sprintf("/runs/%v", run["id"]), "", 200)
		if r["status"] == "finished" {
			if r["verdict"] != "pass" {
				t.Errorf("verdict %v", r["verdict"])
			}
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("run did not finish: %v", r)
		}
		time.Sleep(100 * time.Millisecond)
	}
}
