package api

import (
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/Gudboi-UwU/ndswarm/internal/dummy"
)

func TestProjectsEnvironmentsTests(t *testing.T) {
	srv := newTestServer(t, fstest.MapFS{})
	target := httptest.NewServer(dummy.Handler())
	defer target.Close()

	admin, viewer := newClient(t, srv.URL), newClient(t, srv.URL)
	admin.expect("POST", "/auth/setup", `{"username":"admin","password":"password1"}`, 201)
	admin.expect("POST", "/users", `{"username":"vera","password":"password1","role":"viewer"}`, 201)
	viewer.expect("POST", "/auth/login", `{"username":"vera","password":"password1"}`, 200)

	admin.expect("POST", "/projects", `{"name":" "}`, 400)
	p := admin.expect("POST", "/projects", `{"name":"Shop","description":"checkout"}`, 201)
	pid := int(p["id"].(float64))
	viewer.expect("POST", "/projects", `{"name":"x"}`, 403)
	viewer.expect("GET", fmt.Sprintf("/projects/%d", pid), "", 200)

	// Environment: secrets are encrypted, masked in responses and kept when sent back masked.
	envBody := fmt.Sprintf(`{"name":"local","baseUrl":%q,"variables":[{"key":"user","value":"demo","secret":false},{"key":"pass","value":"hunter22","secret":true}],
		"headers":[],"auth":{"type":"none"}}`, target.URL)
	e := admin.expect("POST", fmt.Sprintf("/projects/%d/environments", pid), envBody, 201)
	eid := int(e["id"].(float64))
	vars := e["variables"].([]any)
	if vars[1].(map[string]any)["value"] != "••••••••" || vars[0].(map[string]any)["value"] != "demo" {
		t.Errorf("secret not masked: %v", vars)
	}
	masked, _ := json.Marshal(e)
	admin.expect("PUT", fmt.Sprintf("/environments/%d", eid), string(masked), 200)
	admin.expect("PUT", fmt.Sprintf("/environments/%d", eid), `{"name":"x","baseUrl":"ftp://nope","variables":[],"headers":[],"auth":{"type":"none"}}`, 400)

	// Test: validation errors carry paths.
	tst := admin.expect("POST", fmt.Sprintf("/projects/%d/tests", pid), fmt.Sprintf(`{"name":"Checkout","environmentId":%d,"flows":[]}`, eid), 201)
	tid := int(tst["id"].(float64))
	out := admin.expect("PUT", fmt.Sprintf("/tests/%d", tid), `{"name":"Checkout","flows":[{"id":"f1","name":"Login","enabled":true,"weight":1,
		"steps":[{"id":"s1","name":"Login","enabled":true,"method":"FETCH","url":"{{nope}}","body":{"type":"none"}}]}]}`, 400)
	paths := []string{}
	for _, d := range out["error"].(map[string]any)["details"].([]any) {
		paths = append(paths, d.(map[string]any)["path"].(string))
	}
	if got := strings.Join(paths, ","); got != "flows.0.steps.0.method,flows.0.steps.0.url" {
		t.Errorf("paths %s", got)
	}

	login := `{"id":"s1","name":"Login","enabled":true,"method":"POST","url":"/login","query":[],"headers":[],
		"body":{"type":"json","variantPick":"roundRobin","variants":[{"id":"v1","name":"demo","weight":1,"enabled":true,"mode":"fields",
		"fields":[{"key":"username","type":"string","value":"{{var \"user\"}}"},{"key":"password","type":"string","value":"{{var \"pass\"}}"}]}]},
		"timeoutMs":5000,"followRedirects":true}`
	admin.expect("PUT", fmt.Sprintf("/tests/%d", tid), fmt.Sprintf(`{"name":"Checkout","environmentId":%d,
		"flows":[{"id":"f1","name":"Login","enabled":true,"weight":1,"steps":[%s]}]}`, eid, login), 200)
	got := viewer.expect("GET", fmt.Sprintf("/tests/%d", tid), "", 200)
	if len(got["flows"].([]any)) != 1 {
		t.Errorf("saved test: %v", got)
	}
	list := admin.expect("GET", fmt.Sprintf("/projects/%d", pid), "", 200)
	if list["testCount"].(float64) != 1 {
		t.Errorf("testCount %v", list)
	}
	dup := admin.expect("POST", fmt.Sprintf("/tests/%d/duplicate", tid), "", 201)
	if dup["name"] != "Checkout (copy)" {
		t.Errorf("duplicate name %v", dup["name"])
	}

	// Try: real request to the dummy target (which rejects hunter22); the secret is redacted in the shown request.
	res := admin.expect("POST", "/tools/try", fmt.Sprintf(`{"environmentId":%d,"step":%s}`, eid, login), 200)
	resp, _ := res["response"].(map[string]any)
	if res["error"] != nil || resp["status"].(float64) != 401 || !strings.Contains(resp["body"].(string), "invalid credentials") {
		t.Errorf("try login: %v", res)
	}
	if body := res["request"].(map[string]any)["body"].(string); body != `{"username":"demo","password":"***"}` {
		t.Errorf("secret not redacted in shown request: %s", body)
	}
	viewer.expect("POST", "/tools/try", fmt.Sprintf(`{"environmentId":%d,"step":%s}`, eid, login), 403)

	res = admin.expect("POST", "/tools/try", `{"step":{"id":"s","name":"meta","method":"GET","url":"http://169.254.169.254/"}}`, 200)
	if e := res["error"].(map[string]any); e["category"] != "connection" || !strings.Contains(e["message"].(string), "blocked") {
		t.Errorf("metadata not blocked: %v", res)
	}

	// Render: samples, type check, and friendly errors.
	r := admin.expect("POST", "/tools/render", `{"template":"{{int 1 3}}","type":"integer"}`, 200)
	if len(r["samples"].([]any)) != 5 || r["error"] != nil {
		t.Errorf("render: %v", r)
	}
	r = admin.expect("POST", "/tools/render", `{"template":"{{name}}","type":"integer"}`, 200)
	if r["error"] == nil {
		t.Errorf("render type mismatch not reported: %v", r)
	}
	if code, _ := viewer.do("GET", "/tools/generators", ""); code != 200 {
		t.Errorf("generators for viewer: %d", code)
	}

	// Folders: move a test, rename a folder (and its subfolders), both edit-only.
	viewer.expect("POST", fmt.Sprintf("/tests/%d/folder", tid), `{"folder":"Billing"}`, 403)
	moved := admin.expect("POST", fmt.Sprintf("/tests/%d/folder", tid), `{"folder":"Billing"}`, 200)
	if moved["folder"] != "Billing" {
		t.Errorf("move: %v", moved)
	}
	deep := strings.Repeat("a / ", 8) + "a"
	admin.expect("POST", fmt.Sprintf("/tests/%d/folder", tid), fmt.Sprintf(`{"folder":%q}`, deep), 400)

	viewer.expect("POST", fmt.Sprintf("/projects/%d/folders/rename", pid), `{"from":"Billing","to":"Accounts"}`, 403)
	admin.expect("POST", fmt.Sprintf("/projects/%d/folders/rename", pid), `{"from":"Billing","to":"Accounts"}`, 204)
	got = admin.expect("GET", fmt.Sprintf("/tests/%d", tid), "", 200)
	if got["folder"] != "Accounts" {
		t.Errorf("after rename: %v", got)
	}
	admin.expect("POST", fmt.Sprintf("/projects/%d/folders/rename", pid), `{"from":"Nope","to":"Else"}`, 404)

	admin.expect("DELETE", fmt.Sprintf("/projects/%d", pid), "", 204)
	admin.expect("GET", fmt.Sprintf("/tests/%d", tid), "", 404)
}
