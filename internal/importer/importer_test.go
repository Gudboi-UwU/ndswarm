package importer

import (
	"encoding/json"
	"os"
	"reflect"
	"strings"
	"testing"

	"github.com/Gudboi-UwU/ndswarm/internal/model"
)

func fixture(t *testing.T) (Bundle, []string) {
	t.Helper()
	data, err := os.ReadFile("testdata/shop.postman_collection.json")
	if err != nil {
		t.Fatal(err)
	}
	b, warns, err := Decode(string(data), "")
	if err != nil {
		t.Fatal(err)
	}
	return b, warns
}

func step(t *testing.T, b Bundle, test, name string) model.Step {
	t.Helper()
	for _, tt := range b.Tests {
		for _, f := range tt.Flows {
			if tt.Name == test && f.Name == name {
				return f.Steps[0]
			}
		}
	}
	t.Fatalf("no request %q in test %q", name, test)
	return model.Step{}
}

func TestPostmanMapping(t *testing.T) {
	b, warns := fixture(t)
	if b.Format != "postman" || b.Project.Name != "Shop API" || b.Project.Description == "" {
		t.Errorf("project: %+v", b.Project)
	}
	counts := map[string]int{}
	for _, tt := range b.Tests {
		counts[tt.Name] = len(tt.Flows)
		if tt.Server != "Shop API" {
			t.Errorf("test %s server %q", tt.Name, tt.Server)
		}
	}
	if want := map[string]int{"Auth": 2, "Orders": 6, "Shop API": 1}; !reflect.DeepEqual(counts, want) {
		t.Errorf("tests %v, want %v", counts, want)
	}

	if len(b.Servers) != 1 {
		t.Fatalf("servers %+v", b.Servers)
	}
	s := b.Servers[0]
	if s.BaseURL != "https://shop.example.com/api" {
		t.Errorf("baseUrl %q", s.BaseURL)
	}
	wantVars := []model.EnvVar{{Key: "token", Value: "dev-token-123"}, {Key: "tenant_id", Value: "acme"}}
	if !reflect.DeepEqual(s.Variables, wantVars) {
		t.Errorf("variables %+v", s.Variables)
	}
	if s.Auth != (model.Auth{Type: "bearer", Token: `{{var "token"}}`}) {
		t.Errorf("auth %+v", s.Auth)
	}

	me := step(t, b, "Auth", "Me")
	if me.URL != "/me" || me.Headers[0].Value != `{{var "tenant_id"}}` {
		t.Errorf("me: %+v", me)
	}
	if del := step(t, b, "Orders", "Admin / Delete order"); del.Method != "DELETE" || del.URL != "/orders/:id" {
		t.Errorf("delete: %+v", del)
	}
	list := step(t, b, "Orders", "List orders")
	wantQ := []model.KV{{Key: "page", Value: "1", Enabled: true}, {Key: "limit", Value: "{{int 0 1000}}", Enabled: true}, {Key: "debug", Value: "true"}}
	if list.URL != "/orders" || !reflect.DeepEqual(list.Query, wantQ) {
		t.Errorf("list: %q %+v", list.URL, list.Query)
	}
	if h := step(t, b, "Shop API", "Health"); h.URL != "/health" || h.TimeoutMs != 30000 || !h.FollowRedirects {
		t.Errorf("health: %+v", h)
	}

	login := step(t, b, "Auth", "Login").Body
	if login.Type != "json" || login.Variants[0].Mode != "fields" {
		t.Fatalf("login body: %+v", login)
	}
	if f := login.Variants[0].Fields; f[0].Value != "{{email}}" || f[1].Value != "secret123" || f[2].Type != "boolean" || f[2].Value != "true" {
		t.Errorf("login fields: %+v", f)
	}

	create := step(t, b, "Orders", "Create order")
	fields := create.Body.Variants[0].Fields
	types := []string{}
	for _, f := range fields {
		types = append(types, f.Key+":"+f.Type)
	}
	if got := strings.Join(types, ","); got != "orderId:string,customer:object,items:array,color:string,coupon:null,total:number" {
		t.Errorf("create fields: %s", got)
	}
	items := fields[2]
	if *items.ArrayLen != (model.MinMax{Min: 2, Max: 2}) || items.Children[0].Children[1].Type != "integer" || items.Children[0].Children[2].Value != "19.99" {
		t.Errorf("items: %+v", items)
	}
	if fields[0].Value != "{{uuid}}" || fields[3].Value != `{{"{{$randomHexColor}}"}}` || create.Headers[1].Enabled {
		t.Errorf("create values: %+v %+v", fields, create.Headers)
	}

	quick := step(t, b, "Orders", "Quick order").Body
	if quick.Type != "form" || len(quick.Variants[0].Fields) != 2 || quick.Variants[0].Fields[1].Value != "{{int 0 1000}}" {
		t.Errorf("urlencoded: %+v", quick)
	}
	upload := step(t, b, "Orders", "Upload invoice").Body
	if upload.Type != "multipart" || len(upload.Variants[0].Fields) != 1 {
		t.Errorf("formdata: %+v", upload)
	}
	gql := step(t, b, "Orders", "Order graph").Body
	var parsed map[string]any
	if gql.Type != "json" || json.Unmarshal([]byte(gql.Variants[0].Raw), &parsed) != nil || parsed["query"] != "query { orders { id total } }" {
		t.Errorf("graphql: %+v", gql)
	}

	all := strings.Join(warns, "\n")
	for _, want := range []string{`Folder "Auth": 1 pre-request script was not imported`, `Request "Me": 1 test script was not imported`,
		`{{$randomHexColor}}`, `file field "file"`, `Request "Login" turns sign-in off`} {
		if !strings.Contains(all, want) {
			t.Errorf("missing warning %q in:\n%s", want, all)
		}
	}
	if strings.Count(all, "$randomHexColor") != 1 {
		t.Errorf("unknown variable warned more than once:\n%s", all)
	}
}

func TestDetect(t *testing.T) {
	cases := []struct{ in, env, err string }{
		{`{"name":"dev","values":[{"key":"a","value":"1"}]}`, "", "Postman environment"},
		{`{"hello":1}`, "", "not an ndswarm export"},
		{`[1,2]`, "", "not a JSON object"},
		{`not: [valid`, "", "neither valid JSON nor valid YAML"},
		{`{"format":"ndswarm","version":2}`, "", "version 2"},
	}
	for _, c := range cases {
		if _, _, err := Decode(c.in, c.env); err == nil || !strings.Contains(err.Error(), c.err) {
			t.Errorf("%s: got %v, want %q", c.in, err, c.err)
		}
	}
	if _, _, err := Decode(strings.Repeat(" ", MaxSize+1), ""); err == nil {
		t.Error("oversized file accepted")
	}
}

func TestPostmanEnvironmentAndSharedHost(t *testing.T) {
	col := `{"info":{"name":"X","schema":"https://schema.getpostman.com/json/collection/v2.0.0/collection.json"},
		"item":[{"name":"a","request":"https://api.test/a?x=1"},{"name":"b","request":{"method":"get","url":"https://api.test/b/{{id}}"}}]}`
	env := `{"name":"staging","values":[{"key":"id","value":"7","enabled":true},{"key":"pw","value":"s3","type":"secret","enabled":true}]}`
	b, _, err := Decode(col, env)
	if err != nil {
		t.Fatal(err)
	}
	s := b.Servers[0]
	if s.Name != "staging" || s.BaseURL != "https://api.test" || !s.Variables[1].Secret {
		t.Errorf("server %+v", s)
	}
	a, bb := b.Tests[0].Flows[0].Steps[0], b.Tests[0].Flows[1].Steps[0]
	if a.URL != "/a" || a.Query[0].Key != "x" || bb.Method != "GET" || bb.URL != `/b/{{var "id"}}` {
		t.Errorf("steps %+v %+v", a, bb)
	}
}

func sample() (model.Project, []model.Environment, []model.Test) {
	id := int64(3)
	yes := true
	env := model.Environment{ID: id, Name: "local", BaseURL: "http://localhost:8090",
		Variables: []model.EnvVar{{Key: "user", Value: "demo"}, {Key: "pass", Value: "hunter22", Secret: true}},
		Headers:   []model.EnvVar{{Key: "X-Api", Value: "k-123", Secret: true}},
		Auth:      model.Auth{Type: "bearer", Token: "tok-999"}}
	t := model.Test{Name: "Checkout", Description: "d", EnvironmentID: &id, Settings: model.DefaultSettings, Flows: []model.Flow{
		{ID: "f1", Name: "Home", Enabled: true, Weight: 2, Steps: []model.Step{{ID: "s1", Name: "Home", Enabled: true, Method: "GET", URL: "/fast",
			Query: []model.KV{{Key: "ms", Value: "{{int 20 80}}", Enabled: true}}, Body: model.Body{Type: "none"}}}},
		{ID: "f2", Name: "Order", Enabled: true, Weight: 1, Steps: []model.Step{{ID: "s2", Name: "Order", Enabled: true, Method: "POST", URL: "/echo",
			Body: model.Body{Type: "json", Variants: []model.Variant{{ID: "v", Name: "v", Weight: 1, Enabled: true, Fields: []model.Field{
				{Key: "user", Type: "string", Value: `{{var "user"}}`},
				{Key: "qty", Type: "integer", Value: "3"},
				{Key: "tags", Type: "array", ArrayLen: &model.MinMax{Min: 1, Max: 1}, Children: []model.Field{{Type: "string", Value: "a"}}},
				{Key: "gift", Type: "boolean", Value: "false", Enabled: &yes},
			}}}}}}},
		{ID: "f3", Name: "Form", Enabled: true, Weight: 1, Steps: []model.Step{{ID: "s3", Name: "Form", Enabled: true, Method: "PUT", URL: "https://other.test/x",
			Body: model.Body{Type: "form", Variants: []model.Variant{{ID: "v", Name: "v", Weight: 1, Enabled: true, Fields: []model.Field{{Key: "a", Type: "string", Value: "{{uuid}}"}}}}}}}},
	}}
	return model.Project{Name: "Shop", Description: "p"}, []model.Environment{env}, []model.Test{t}
}

func TestNativeRoundTripAndSecrets(t *testing.T) {
	p, envs, tests := sample()
	for _, typ := range []string{"json", "yaml"} {
		b := FromProject(p, envs, tests)
		out, err := b.Marshal(typ)
		if err != nil {
			t.Fatal(err)
		}
		for _, secret := range []string{"hunter22", "k-123", "tok-999"} {
			if strings.Contains(string(out), secret) {
				t.Errorf("%s export leaks %q", typ, secret)
			}
		}
		got, warns, err := Decode(string(out), "")
		if err != nil {
			t.Fatalf("%s: %v", typ, err)
		}
		if len(warns) != 2 { // bearer turned off, two empty secrets
			t.Errorf("%s warnings: %v", typ, warns)
		}
		want := tests[0]
		want.Normalize()
		gt := got.Tests[0].model()
		gt.EnvironmentID, gt.Description = want.EnvironmentID, want.Description
		if !reflect.DeepEqual(gt, want) || got.Tests[0].Server != "local" || got.Project != (ProjectInfo{"Shop", "p"}) {
			t.Errorf("%s round trip:\n got %+v\nwant %+v", typ, gt, want)
		}
		if s := got.Servers[0]; s.BaseURL != "http://localhost:8090" || s.Variables[0].Value != "demo" || s.Variables[1].Value != "" || !s.Variables[1].Secret {
			t.Errorf("%s server %+v", typ, s)
		}
	}
	if envs[0].Variables[1].Value != "hunter22" {
		t.Error("export changed the caller's environment")
	}
}

func TestPostmanRoundTrip(t *testing.T) {
	check := func(name string, b Bundle, folders bool) {
		out, err := b.Postman(folders)
		if err != nil {
			t.Fatal(err)
		}
		if strings.Contains(string(out), "tok-999") || strings.Contains(string(out), "hunter22") {
			t.Errorf("%s: postman export leaks a secret", name)
		}
		got, _, err := Decode(string(out), "")
		if err != nil {
			t.Fatalf("%s: %v\n%s", name, err, out)
		}
		var want, have []string
		for _, tt := range b.Tests {
			for _, f := range tt.Flows {
				s := f.Steps[0]
				want = append(want, s.Method+" "+s.URL+" "+s.Body.Type)
			}
		}
		for _, tt := range got.Tests {
			for _, f := range tt.Flows {
				s := f.Steps[0]
				have = append(have, s.Method+" "+s.URL+" "+s.Body.Type)
			}
		}
		if !reflect.DeepEqual(have, want) {
			t.Errorf("%s requests:\n got %v\nwant %v", name, have, want)
		}
	}
	p, envs, tests := sample()
	b := FromProject(p, envs, tests)
	// Absolute URLs on another host stay absolute; everything else is relative to {{baseUrl}}.
	b.Tests[0].Flows[2].Steps[0].URL = "/x"
	check("sample", b, false)

	fb, _ := fixture(t)
	check("fixture", fb, true)
	out, _ := fb.Postman(true)
	for _, want := range []string{`"raw": "{{baseUrl}}/orders?page=1&limit={{$randomInt}}"`, `"key": "debug"`, `"disabled": true`, `\"{{$randomEmail}}\"`, `"type": "bearer"`} {
		if !strings.Contains(string(out), want) {
			t.Errorf("postman export misses %s", want)
		}
	}
}

func TestUniqueName(t *testing.T) {
	taken := map[string]bool{"a": true, "a (2)": true}
	if got := uniqueName("A", taken); got != "A (3)" {
		t.Errorf("got %q", got)
	}
	if !taken["a (3)"] {
		t.Error("not marked taken")
	}
}
