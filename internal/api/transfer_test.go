package api

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"testing"
	"testing/fstest"
)

func TestImportExport(t *testing.T) {
	srv := newTestServer(t, fstest.MapFS{})
	admin, viewer := newClient(t, srv.URL), newClient(t, srv.URL)
	admin.expect("POST", "/auth/setup", `{"username":"admin","password":"password1"}`, 201)
	admin.expect("POST", "/users", `{"username":"vera","password":"password1","role":"viewer"}`, 201)
	viewer.expect("POST", "/auth/login", `{"username":"vera","password":"password1"}`, 200)

	raw, err := os.ReadFile("../importer/testdata/shop.postman_collection.json")
	if err != nil {
		t.Fatal(err)
	}
	content, _ := json.Marshal(string(raw))
	body := fmt.Sprintf(`{"content":%s}`, content)

	prev := admin.expect("POST", "/import/preview", body, 200)
	if prev["format"] != "postman" || len(prev["tests"].([]any)) != 3 || len(prev["warnings"].([]any)) == 0 {
		t.Errorf("preview: %v", prev)
	}
	if s := prev["servers"].([]any)[0].(map[string]any); s["baseUrl"] != "https://shop.example.com/api" || s["variables"].(float64) != 2 {
		t.Errorf("preview server: %v", s)
	}
	admin.expect("POST", "/import/preview", `{"content":"{\"hello\":1}"}`, 400)
	viewer.expect("POST", "/import/preview", body, 403)
	viewer.expect("POST", "/import", body, 403)

	// New project, then the same file again into it: tests get " (2)", the server is reused.
	res := admin.expect("POST", "/import", fmt.Sprintf(`{"content":%s,"newProject":"My shop"}`, content), 201)
	pid := int(res["projectId"].(float64))
	if len(res["tests"].([]any)) != 3 {
		t.Errorf("import: %v", res)
	}
	res = admin.expect("POST", "/import", fmt.Sprintf(`{"content":%s,"projectId":%d}`, content, pid), 201)
	names := []string{}
	for _, tt := range res["tests"].([]any) {
		names = append(names, tt.(map[string]any)["name"].(string))
	}
	if strings.Join(names, ",") != "Auth (2),Orders (2),Shop API (2)" || !strings.Contains(fmt.Sprint(res["warnings"]), "already exists") {
		t.Errorf("second import: %v", res)
	}
	envs := getList(t, admin, fmt.Sprintf("/projects/%d/environments", pid))
	if len(envs) != 1 {
		t.Errorf("servers: %v", envs)
	}
	tests := getList(t, admin, fmt.Sprintf("/projects/%d/tests", pid))
	if len(tests) != 6 || tests[0]["environmentId"] == nil {
		t.Errorf("tests: %v", tests)
	}
	admin.expect("POST", "/import", fmt.Sprintf(`{"content":%s,"projectId":99999}`, content), 404)

	// Export: a secret variable and the bearer token never leave the server.
	eid := int(envs[0]["id"].(float64))
	admin.expect("PUT", fmt.Sprintf("/environments/%d", eid), `{"name":"Shop API","baseUrl":"https://shop.example.com/api",
		"variables":[{"key":"token","value":"hunter22-secret","secret":true}],"headers":[{"key":"X-Key","value":"hdr-secret","secret":true}],
		"auth":{"type":"bearer","token":"tok-secret"}}`, 200)
	tid := 0 // the Orders test: pick by name, list order is not part of this test
	for _, tt := range tests {
		if strings.HasPrefix(tt["name"].(string), "Orders") {
			tid = int(tt["id"].(float64))
		}
	}
	if tid == 0 {
		t.Fatalf("no Orders test in %v", tests)
	}
	for _, c := range []struct{ path, file string }{
		{fmt.Sprintf("/tests/%d/export", tid), ".ndswarm.json"},
		{fmt.Sprintf("/tests/%d/export?format=ndswarm&type=yaml", tid), ".ndswarm.yaml"},
		{fmt.Sprintf("/tests/%d/export?format=postman", tid), ".postman_collection.json"},
		{fmt.Sprintf("/projects/%d/export", pid), "my-shop.ndswarm.json"},
		{fmt.Sprintf("/projects/%d/export?format=postman", pid), "my-shop.postman_collection.json"},
	} {
		res, err := viewer.http.Get(srv.URL + "/api/v1" + c.path)
		if err != nil {
			t.Fatal(err)
		}
		out, _ := io.ReadAll(res.Body)
		res.Body.Close()
		if res.StatusCode != 200 || !strings.Contains(res.Header.Get("Content-Disposition"), c.file) {
			t.Errorf("%s: %d %q", c.path, res.StatusCode, res.Header.Get("Content-Disposition"))
		}
		for _, secret := range []string{"hunter22-secret", "hdr-secret", "tok-secret"} {
			if strings.Contains(string(out), secret) {
				t.Errorf("%s leaks %s", c.path, secret)
			}
		}
		if strings.HasSuffix(c.file, ".json") && !strings.Contains(string(out), "/orders") && !strings.Contains(string(out), "/me") {
			t.Errorf("%s: no requests in export", c.path)
		}
	}
	admin.expect("GET", fmt.Sprintf("/tests/%d/export?format=pdf", tid), "", 400)

	// The native project export imports back into a new project.
	res2, _ := admin.http.Get(srv.URL + "/api/v1" + fmt.Sprintf("/projects/%d/export", pid))
	native, _ := io.ReadAll(res2.Body)
	res2.Body.Close()
	nc, _ := json.Marshal(string(native))
	back := admin.expect("POST", "/import", fmt.Sprintf(`{"content":%s}`, nc), 201)
	if len(back["tests"].([]any)) != 6 {
		t.Errorf("re-import: %v", back)
	}
}

func getList(t *testing.T, c *client, path string) []map[string]any {
	t.Helper()
	req, _ := http.NewRequest("GET", c.base+"/api/v1"+path, nil)
	res, err := c.http.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var out []map[string]any
	json.NewDecoder(res.Body).Decode(&out)
	return out
}
