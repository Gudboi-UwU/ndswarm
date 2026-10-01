package api

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/Gudboi-UwU/ndswarm/internal/model"
)

// doProblems is like client.expect but for endpoints that return a bare []model.FieldError.
func (c *client) doProblems(method, path, body string) (int, []model.FieldError) {
	c.t.Helper()
	req, _ := http.NewRequest(method, c.base+"/api/v1"+path, strings.NewReader(body))
	req.Header.Set("X-Requested-With", "ndswarm")
	res, err := c.http.Do(req)
	if err != nil {
		c.t.Fatal(err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	var out []model.FieldError
	if err := json.Unmarshal(raw, &out); err != nil {
		c.t.Fatalf("%s %s: bad body %s: %v", method, path, raw, err)
	}
	return res.StatusCode, out
}

func TestCheckTest(t *testing.T) {
	srv := newTestServer(t, fstest.MapFS{})
	admin := newClient(t, srv.URL)
	admin.expect("POST", "/auth/setup", `{"username":"admin","password":"password1"}`, 201)
	p := admin.expect("POST", "/projects", `{"name":"P"}`, 201)
	e := admin.expect("POST", fmt.Sprintf("/projects/%v/environments", p["id"]),
		`{"name":"e","baseUrl":"https://api.example.com","variables":[{"key":"token","value":"abc","secret":false}]}`, 201)
	envID := e["id"]

	step := func(url, bodyType, fieldType, fieldValue string) string {
		body := `"body":{"type":"none"}`
		if bodyType != "" {
			body = fmt.Sprintf(`"body":{"type":%q,"variantPick":"roundRobin","variants":[{"id":"v1","name":"v","weight":1,"enabled":true,"mode":"fields",
				"fields":[{"key":"n","type":%q,"value":%q,"children":[]}]}]}`, bodyType, fieldType, fieldValue)
		}
		return fmt.Sprintf(`{"name":"T","environmentId":%v,"flows":[{"id":"f1","name":"f1","enabled":true,"weight":1,
			"steps":[{"id":"s1","name":"s1","enabled":true,"method":"GET","url":%q,%s,"timeoutMs":5000,"followRedirects":true}]}]}`,
			envID, url, body)
	}

	// A clean test using the environment's own variable has no problems.
	code, probs := admin.doProblems("POST", "/tests/check", fmt.Sprintf(`{"test":%s,"environmentId":%v}`, step(`/x?t={{var "token"}}`, "", "", ""), envID))
	if code != 200 || len(probs) != 0 {
		t.Errorf("clean test: %d %v", code, probs)
	}

	// {{var "missing"}} in the URL: one problem at the url path, naming the server.
	code, probs = admin.doProblems("POST", "/tests/check", fmt.Sprintf(`{"test":%s,"environmentId":%v}`, step(`/x?t={{var "missing"}}`, "", "", ""), envID))
	if code != 200 || len(probs) != 1 || probs[0].Path != "flows.0.steps.0.url" || !strings.Contains(probs[0].Message, `"missing" is not set on the server e`) {
		t.Errorf("missing var: %d %v", code, probs)
	}

	// No server chosen: the message says so instead of naming one.
	code, probs = admin.doProblems("POST", "/tests/check", fmt.Sprintf(`{"test":%s,"environmentId":null}`, step(`https://x.test/?t={{var "missing"}}`, "", "", "")))
	if code != 200 || len(probs) != 1 || !strings.Contains(probs[0].Message, "Choose a server") {
		t.Errorf("no server: %d %v", code, probs)
	}

	// A relative URL with no server chosen cannot be resolved.
	code, probs = admin.doProblems("POST", "/tests/check", fmt.Sprintf(`{"test":%s,"environmentId":null}`, step(`/relative`, "", "", "")))
	if code != 200 || len(probs) != 1 || probs[0].Path != "flows.0.steps.0.url" {
		t.Errorf("relative url, no server: %d %v", code, probs)
	}

	// A JSON body field typed "integer" whose rendered value is not a number.
	code, probs = admin.doProblems("POST", "/tests/check", fmt.Sprintf(`{"test":%s,"environmentId":%v}`, step(`/x`, "json", "integer", "not-a-number"), envID))
	if code != 200 || len(probs) != 1 || probs[0].Path != "flows.0.steps.0.body.variants.0.fields.0.value" || !strings.Contains(probs[0].Message, "is not an integer") {
		t.Errorf("typed field: %d %v", code, probs)
	}

	// A parse error in a template surfaces too.
	code, probs = admin.doProblems("POST", "/tests/check", fmt.Sprintf(`{"test":%s,"environmentId":%v}`, step(`/x?t={{var}}`, "", "", ""), envID))
	if code != 200 || len(probs) != 1 || probs[0].Path != "flows.0.steps.0.url" {
		t.Errorf("parse error: %d %v", code, probs)
	}

	// Starting a run with template problems is refused with 400, listing the same problems.
	id := admin.expect("POST", fmt.Sprintf("/projects/%v/tests", p["id"]), step(`/x?t={{var "missing"}}`, "", "", ""), 201)["id"]
	out := admin.expect("POST", fmt.Sprintf("/tests/%v/runs", id), `{}`, 400)
	if probs, _ := out["problems"].([]any); len(probs) != 1 {
		t.Errorf("run start must refuse with the same problems: %v", out)
	}
}
