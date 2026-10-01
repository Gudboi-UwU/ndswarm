package importer

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"regexp"
	"slices"
	"strconv"
	"strings"

	"github.com/Gudboi-UwU/ndswarm/internal/model"
)

// Postman Collection v2.0/v2.1, only the parts we read. Loose fields stay raw because
// Postman writes them in more than one shape (string or object, array or map).
type pmCollection struct {
	Info struct {
		Name        string          `json:"name"`
		Description json.RawMessage `json:"description"`
	} `json:"info"`
	Item     []pmItem  `json:"item"`
	Variable []pmVar   `json:"variable"`
	Auth     *pmAuth   `json:"auth"`
	Event    []pmEvent `json:"event"`
}

type pmItem struct {
	Name        string          `json:"name"`
	Description json.RawMessage `json:"description"`
	Item        []pmItem        `json:"item"`
	Request     json.RawMessage `json:"request"`
	Auth        *pmAuth         `json:"auth"`
	Event       []pmEvent       `json:"event"`
}

type pmRequest struct {
	Method      string          `json:"method"`
	URL         json.RawMessage `json:"url"`
	Header      json.RawMessage `json:"header"`
	Body        *pmBody         `json:"body"`
	Auth        *pmAuth         `json:"auth"`
	Description json.RawMessage `json:"description"`
}

type pmURL struct {
	Raw      string          `json:"raw"`
	Protocol string          `json:"protocol"`
	Host     json.RawMessage `json:"host"`
	Path     json.RawMessage `json:"path"`
	Port     string          `json:"port"`
	Query    []pmKV          `json:"query"`
}

type pmKV struct {
	Key      string `json:"key"`
	Value    any    `json:"value"`
	Disabled bool   `json:"disabled"`
	Type     string `json:"type"`
}

type pmVar struct {
	Key      string `json:"key"`
	ID       string `json:"id"` // v2.0 sometimes uses id instead of key
	Value    any    `json:"value"`
	Disabled bool   `json:"disabled"`
	Enabled  *bool  `json:"enabled"` // environment files
	Type     string `json:"type"`
}

type pmBody struct {
	Mode       string `json:"mode"`
	Raw        string `json:"raw"`
	URLEncoded []pmKV `json:"urlencoded"`
	FormData   []pmKV `json:"formdata"`
	GraphQL    *struct {
		Query     string `json:"query"`
		Variables string `json:"variables"`
	} `json:"graphql"`
	Options struct {
		Raw struct {
			Language string `json:"language"`
		} `json:"raw"`
	} `json:"options"`
	Disabled bool `json:"disabled"`
}

type pmAuth struct {
	Type   string          `json:"type"`
	Bearer json.RawMessage `json:"bearer"`
	Basic  json.RawMessage `json:"basic"`
	APIKey json.RawMessage `json:"apikey"`
}

type pmEvent struct {
	Listen string `json:"listen"`
	Script struct {
		Exec json.RawMessage `json:"exec"`
	} `json:"script"`
}

type pmEnv struct {
	Name   string  `json:"name"`
	Values []pmVar `json:"values"`
}

// dynamic maps Postman dynamic variables to generators.
var dynamic = map[string]string{
	"$guid": "uuid", "$randomUUID": "uuid", "$timestamp": "timestamp", "$isoTimestamp": "now",
	"$randomInt": "int 0 1000", "$randomEmail": "email", "$randomExampleEmail": "email",
	"$randomFirstName": "firstName", "$randomLastName": "lastName", "$randomFullName": "name",
	"$randomUserName": "username", "$randomPassword": "password", "$randomPhoneNumber": "phone",
	"$randomCity": "city", "$randomCountry": "country", "$randomCompanyName": "company",
	"$randomJobTitle": "jobTitle", "$randomStreetAddress": "address", "$randomUrl": "url",
	"$randomIP": "ipv4", "$randomIPV4": "ipv4", "$randomLoremSentence": "sentence 6",
	"$randomBoolean": "bool", "$randomAlphaNumeric": "string 1 1",
}

// rawTypes gives a content type for Postman's raw body languages when no header sets one.
var rawTypes = map[string]string{"xml": "application/xml", "html": "text/html", "javascript": "application/javascript", "text": "text/plain"}

var placeholder = regexp.MustCompile(`\{\{([^{}]+)\}\}`)

// pm holds conversion state for one collection.
type pm struct {
	vars     map[string]string // Postman name -> value, collection then environment
	seen     map[string]bool   // warned unknown dynamic variables
	warns    []string
	colAuth  *pmAuth
	colQuery *pmAuth // collection API key sent as a query parameter: added to every request
	baseVar  string  // "{{name}}" prefix replaced by the server base URL
	base     string  // scheme://host prefix replaced by the server base URL
}

// piece is literal text or a template expression (without braces).
type piece struct {
	expr bool
	text string
}

// pieces splits Postman text into literals and converted placeholders.
func (c *pm) pieces(s string) []piece {
	var out []piece
	last := 0
	for _, m := range placeholder.FindAllStringSubmatchIndex(s, -1) {
		if m[0] > last {
			out = append(out, piece{false, s[last:m[0]]})
		}
		name := strings.TrimSpace(s[m[2]:m[3]])
		switch gen, ok := dynamic[name]; {
		case ok:
			out = append(out, piece{true, gen})
		case strings.HasPrefix(name, "$"):
			if !c.seen[name] {
				c.seen[name] = true
				c.warns = append(c.warns, fmt.Sprintf("The Postman variable {{%s}} has no match here, so it is kept as plain text.", name))
			}
			out = append(out, piece{false, s[m[0]:m[1]]})
		default:
			out = append(out, piece{true, "var " + strconv.Quote(varKey(name))})
		}
		last = m[1]
	}
	if last < len(s) {
		out = append(out, piece{false, s[last:]})
	}
	return out
}

// conv turns Postman text into a template: {{name}} -> {{var "name"}}, {{$guid}} -> {{uuid}}.
func (c *pm) conv(s string) string {
	var b strings.Builder
	for _, p := range c.pieces(s) {
		switch {
		case p.expr:
			b.WriteString("{{" + p.text + "}}")
		case strings.Contains(p.text, "{{"):
			b.WriteString("{{" + strconv.Quote(p.text) + "}}") // literal braces
		default:
			b.WriteString(p.text)
		}
	}
	return b.String()
}

// expr turns Postman text into one template expression, for use as a function argument.
func (c *pm) expr(s string) string {
	parts := []string{}
	for _, p := range c.pieces(s) {
		if p.expr {
			parts = append(parts, "("+p.text+")")
		} else {
			parts = append(parts, strconv.Quote(p.text))
		}
	}
	return "(print " + strings.Join(parts, " ") + ")"
}

var badVarChar = regexp.MustCompile(`[^A-Za-z0-9_]`)

// varKey makes a Postman variable name a valid server variable name.
func varKey(name string) string {
	k := badVarChar.ReplaceAllString(strings.TrimSpace(name), "_")
	if k == "" || (k[0] >= '0' && k[0] <= '9') {
		k = "_" + k
	}
	return k
}

func decodePostman(data, envData []byte, split string) (Bundle, []string, error) {
	if split != "top" {
		split = "folder"
	}
	var col pmCollection
	if err := json.Unmarshal(data, &col); err != nil {
		return Bundle{}, nil, fmt.Errorf("this Postman collection is damaged: %v", err)
	}
	c := &pm{vars: map[string]string{}, seen: map[string]bool{}, colAuth: col.Auth}
	server := Server{Name: col.Info.Name, Variables: []model.EnvVar{}, Headers: []model.EnvVar{}}
	var order []string
	secret := map[string]bool{}
	addVar := func(v pmVar, isSecret bool) {
		key := v.Key
		if key == "" {
			key = v.ID
		}
		if key == "" || v.Disabled || (v.Enabled != nil && !*v.Enabled) {
			return
		}
		if _, ok := c.vars[key]; !ok {
			order = append(order, key)
		}
		c.vars[key] = str(v.Value)
		secret[key] = secret[key] || isSecret
	}
	for _, v := range col.Variable {
		addVar(v, false)
	}
	if len(envData) > 0 {
		var env pmEnv
		if err := json.Unmarshal(envData, &env); err != nil || env.Values == nil {
			return Bundle{}, nil, errors.New("the environment file is not a Postman environment")
		}
		for _, v := range env.Values {
			addVar(v, v.Type == "secret")
		}
		if env.Name != "" {
			server.Name = env.Name
		}
	}

	b := Bundle{Format: "postman", Version: 1, Project: ProjectInfo{col.Info.Name, text(col.Info.Description)}, Servers: []Server{}, Tests: []Test{}}
	c.scripts("Collection", col.Event)

	// Collect requests per test first: the base URL depends on all of them.
	type req struct {
		name  string
		r     pmRequest
		auth  *pmAuth // nearest folder/request auth, nil = collection
		test  int
		where string
	}
	var reqs []req
	var walk func(items []pmItem, prefix string, test int, auth *pmAuth)
	walk = func(items []pmItem, prefix string, test int, auth *pmAuth) {
		for _, it := range items {
			a := auth
			if it.Auth != nil && it.Auth.Type != "inherit" {
				a = it.Auth
			}
			if it.Request == nil {
				c.scripts(fmt.Sprintf("Folder %q", it.Name), it.Event)
				walk(it.Item, prefix+it.Name+" / ", test, a)
				continue
			}
			r := pmRequest{Method: "GET", URL: it.Request} // a request can be just its URL
			if it.Request[0] != '"' && json.Unmarshal(it.Request, &r) != nil {
				c.warns = append(c.warns, fmt.Sprintf("Request %q was skipped: it could not be read.", it.Name))
				continue
			}
			if r.Auth != nil && r.Auth.Type != "inherit" {
				a = r.Auth
			}
			c.scripts(fmt.Sprintf("Request %q", it.Name), it.Event)
			reqs = append(reqs, req{prefix + it.Name, r, a, test, it.Name})
		}
	}
	// processFolder implements the "folder" split: a folder with its own direct requests becomes a
	// test named after it (next to its subfolders' tests when it has both); a folder with only
	// subfolders contributes no test of its own, just the folder path its children land in.
	var processFolder func(it pmItem, ancestors []string, auth *pmAuth)
	processFolder = func(it pmItem, ancestors []string, auth *pmAuth) {
		a := auth
		if it.Auth != nil && it.Auth.Type != "inherit" {
			a = it.Auth
		}
		c.scripts(fmt.Sprintf("Folder %q", it.Name), it.Event)
		var direct, sub []pmItem
		for _, child := range it.Item {
			if child.Request == nil {
				sub = append(sub, child)
			} else {
				direct = append(direct, child)
			}
		}
		if len(direct) > 0 {
			folderPath := ancestors
			if len(sub) > 0 {
				folderPath = append(append([]string{}, ancestors...), it.Name)
			}
			b.Tests = append(b.Tests, Test{Name: it.Name, Description: text(it.Description), Folder: folderSegments(folderPath)})
			walk(direct, "", len(b.Tests)-1, a)
		}
		if len(sub) > 0 {
			nested := append(append([]string{}, ancestors...), it.Name)
			for _, sf := range sub {
				processFolder(sf, nested, a)
			}
		}
	}

	root := -1
	for _, it := range col.Item {
		if it.Request == nil {
			if split == "folder" {
				processFolder(it, nil, nil)
				continue
			}
			b.Tests = append(b.Tests, Test{Name: it.Name, Description: text(it.Description)})
			a := (*pmAuth)(nil)
			if it.Auth != nil && it.Auth.Type != "inherit" {
				a = it.Auth
			}
			c.scripts(fmt.Sprintf("Folder %q", it.Name), it.Event)
			walk(it.Item, "", len(b.Tests)-1, a)
			continue
		}
		if root < 0 {
			b.Tests = append(b.Tests, Test{Name: col.Info.Name, Description: text(col.Info.Description)})
			root = len(b.Tests) - 1
		}
		walk([]pmItem{it}, "", root, nil)
	}

	urls := make([]string, len(reqs))
	for i, r := range reqs {
		urls[i] = c.rawURL(r.r.URL)
	}
	server.BaseURL = c.detectBase(urls)
	for _, k := range order {
		if "{{"+k+"}}" == c.baseVar {
			continue
		}
		server.Variables = append(server.Variables, model.EnvVar{Key: varKey(k), Value: c.conv(c.vars[k]), Secret: secret[k]})
	}
	server.Auth = c.serverAuth(col.Auth)

	for i, r := range reqs {
		f := c.flow(r.name, r.r, urls[i], r.auth, r.where)
		b.Tests[r.test].Flows = append(b.Tests[r.test].Flows, f)
	}
	var tests []Test
	for _, t := range b.Tests {
		if len(t.Flows) == 0 {
			continue
		}
		t.Settings = model.DefaultSettings
		// A folder bigger than one test may hold becomes several tests, so it still imports.
		n := (len(t.Flows) + model.MaxFlows - 1) / model.MaxFlows
		if n == 1 {
			tests = append(tests, t)
			continue
		}
		c.warns = append(c.warns, fmt.Sprintf("%q has %d requests, more than the %d one test can hold, so it was split into %d tests.", t.Name, len(t.Flows), model.MaxFlows, n))
		for i := range n {
			part := t
			part.Name = clip(fmt.Sprintf("%s (part %d of %d)", t.Name, i+1, n))
			part.Flows = t.Flows[i*model.MaxFlows : min((i+1)*model.MaxFlows, len(t.Flows))]
			tests = append(tests, part)
		}
	}
	b.Tests = tests
	if server.BaseURL != "" || len(server.Variables) > 0 || server.Auth.Type != "none" {
		if server.Name = clip(server.Name); server.Name == "" {
			server.Name = "Imported server"
		}
		b.Servers = append(b.Servers, server)
		for i := range b.Tests {
			b.Tests[i].Server = server.Name
		}
	}
	if len(b.Tests) == 0 {
		return b, nil, errors.New("this Postman collection has no requests")
	}
	return b, c.warns, nil
}

// folderSegments joins folder names into one path, the way model.Test.Folder expects it. A " / "
// already inside a name would be read back as a path separator, so it becomes " - " instead.
func folderSegments(names []string) string {
	segs := make([]string, len(names))
	for i, n := range names {
		segs[i] = strings.ReplaceAll(n, " / ", " - ")
	}
	return strings.Join(segs, " / ")
}

// scripts warns once per location that Postman scripts do not run here.
func (c *pm) scripts(where string, events []pmEvent) {
	pre, test := 0, 0
	for _, e := range events {
		var lines []string
		if json.Unmarshal(e.Script.Exec, &lines) != nil {
			var one string
			json.Unmarshal(e.Script.Exec, &one)
			lines = []string{one}
		}
		if strings.TrimSpace(strings.Join(lines, "")) == "" {
			continue
		}
		switch e.Listen {
		case "prerequest":
			pre++
		case "test":
			test++
		}
	}
	var parts []string
	if pre > 0 {
		parts = append(parts, fmt.Sprintf("%d pre-request script", pre))
	}
	if test > 0 {
		parts = append(parts, fmt.Sprintf("%d test script", test))
	}
	if len(parts) > 0 {
		c.warns = append(c.warns, fmt.Sprintf("%s: %s %s not imported (scripts do not run in ndswarm).", where, strings.Join(parts, " and "), plural(pre+test)))
	}
}

func plural(n int) string {
	if n == 1 {
		return "was"
	}
	return "were"
}

// rawURL returns the request URL as Postman text, without query string or fragment.
func (c *pm) rawURL(raw json.RawMessage) string {
	var s string
	if json.Unmarshal(raw, &s) != nil {
		var u pmURL
		json.Unmarshal(raw, &u)
		s = u.Raw
		if s == "" {
			s = strings.Join(strOrList(u.Host), ".")
			if u.Port != "" {
				s += ":" + u.Port
			}
			if p := strOrList(u.Path); len(p) > 0 {
				s += "/" + strings.Join(p, "/")
			}
			if u.Protocol != "" {
				s = u.Protocol + "://" + s
			}
		}
	}
	s = strings.TrimSpace(s)
	if i := strings.IndexAny(s, "?#"); i >= 0 {
		s = s[:i]
	}
	return s
}

// query returns the query rows of a request URL; disabled rows only exist in the object form.
func (c *pm) query(raw json.RawMessage) []model.KV {
	rows := []model.KV{}
	var u pmURL
	if json.Unmarshal(raw, &u) == nil && u.Query != nil {
		for _, q := range u.Query {
			if q.Key != "" {
				rows = append(rows, model.KV{Key: q.Key, Value: c.conv(str(q.Value)), Enabled: !q.Disabled})
			}
		}
		return rows
	}
	var s string
	if json.Unmarshal(raw, &s) != nil {
		s = u.Raw
	}
	_, qs, ok := strings.Cut(s, "?")
	if !ok {
		return rows
	}
	qs, _, _ = strings.Cut(qs, "#")
	for _, part := range strings.Split(qs, "&") {
		k, v, _ := strings.Cut(part, "=")
		if k == "" {
			continue
		}
		if dk, err := url.QueryUnescape(k); err == nil {
			k = dk
		}
		if dv, err := url.QueryUnescape(v); err == nil {
			v = dv
		}
		rows = append(rows, model.KV{Key: k, Value: c.conv(v), Enabled: true})
	}
	return rows
}

var leadVar = regexp.MustCompile(`^\{\{[^{}$]+\}\}`)

// detectBase finds a base URL shared by every request: a leading {{variable}} with a known value,
// or else a shared scheme and host. It sets c.baseVar or c.base and returns the base URL.
func (c *pm) detectBase(urls []string) string {
	if len(urls) == 0 {
		return ""
	}
	if first := leadVar.FindString(urls[0]); first != "" {
		shared := true
		for _, u := range urls {
			shared = shared && strings.HasPrefix(u, first)
		}
		name := strings.TrimSpace(first[2 : len(first)-2])
		if v, ok := c.vars[name]; ok && shared {
			if base := cleanBase(v); base != "" {
				c.baseVar = first
				return base
			}
		}
	}
	origin := func(s string) string {
		u, err := url.Parse(s)
		if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || strings.Contains(u.Host, "{{") {
			return ""
		}
		return u.Scheme + "://" + u.Host
	}
	o := origin(urls[0])
	for _, u := range urls {
		if origin(u) != o {
			return ""
		}
	}
	c.base = o
	return o
}

// cleanBase accepts a variable value as base URL when it is a plain http(s) URL.
func cleanBase(v string) string {
	v = strings.TrimRight(strings.TrimSpace(v), "/")
	if strings.Contains(v, "{{") {
		return ""
	}
	if !strings.Contains(v, "://") {
		v = "http://" + v
	}
	u, err := url.Parse(v)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || u.RawQuery != "" {
		return ""
	}
	return v
}

// relative strips the detected base from a request URL.
func (c *pm) relative(u string) string {
	switch {
	case c.baseVar != "" && strings.HasPrefix(u, c.baseVar):
		u = strings.TrimPrefix(u, c.baseVar)
	case c.base != "" && strings.HasPrefix(u, c.base):
		u = strings.TrimPrefix(u, c.base)
	default:
		return u
	}
	if !strings.HasPrefix(u, "/") {
		u = "/" + u
	}
	return u
}

func (c *pm) flow(name string, r pmRequest, rawURL string, auth *pmAuth, where string) model.Flow {
	if strings.TrimSpace(name) == "" {
		name = r.Method + " " + rawURL
	}
	name = clip(name)
	id := newID()
	method := strings.ToUpper(strings.TrimSpace(r.Method))
	if method == "" {
		method = "GET"
	}
	s := model.Step{ID: id, Name: name, Enabled: true, Method: method, URL: c.conv(c.relative(rawURL)),
		Query: c.query(r.URL), Headers: []model.KV{}, TimeoutMs: model.DefaultTimeout, FollowRedirects: true,
		Body: model.Body{Type: "none", VariantPick: "roundRobin", Variants: []model.Variant{}}}
	contentType := ""
	for _, h := range kvs(r.Header) {
		if h.Key == "" {
			continue
		}
		if strings.EqualFold(h.Key, "Content-Type") && !h.Disabled {
			contentType = str(h.Value)
		}
		s.Headers = append(s.Headers, model.KV{Key: h.Key, Value: c.conv(str(h.Value)), Enabled: !h.Disabled})
	}
	if auth == nil {
		auth = c.colQuery
	}
	if auth != nil && !sameAuth(auth, c.colAuth) {
		c.requestAuth(&s, auth, where)
	}
	if r.Body != nil && !r.Body.Disabled {
		s.Body = c.body(r.Body, contentType, where)
	}
	if s.Body.Type == "multipart" { // the boundary is set when sending
		s.Headers = slices.DeleteFunc(s.Headers, func(h model.KV) bool { return strings.EqualFold(h.Key, "Content-Type") })
	}
	return model.Flow{ID: id, Name: name, Enabled: true, Weight: 1, Steps: []model.Step{s}}
}

func sameAuth(a, b *pmAuth) bool {
	if a == nil || b == nil {
		return a == b
	}
	return a.Type == b.Type && bytes.Equal(a.Bearer, b.Bearer) && bytes.Equal(a.Basic, b.Basic) && bytes.Equal(a.APIKey, b.APIKey)
}

// authParams reads auth settings in the v2.1 shape ([{key, value}]) or the v2.0 shape ({key: value}).
func authParams(raw json.RawMessage) map[string]string {
	out := map[string]string{}
	var list []pmKV
	if json.Unmarshal(raw, &list) == nil {
		for _, kv := range list {
			out[kv.Key] = str(kv.Value)
		}
		return out
	}
	var m map[string]any
	json.Unmarshal(raw, &m)
	for k, v := range m {
		out[k] = str(v)
	}
	return out
}

// serverAuth maps the collection's auth to the server sign-in.
func (c *pm) serverAuth(a *pmAuth) model.Auth {
	if a == nil {
		return model.Auth{Type: "none"}
	}
	switch a.Type {
	case "bearer":
		return model.Auth{Type: "bearer", Token: c.conv(authParams(a.Bearer)["token"])}
	case "basic":
		p := authParams(a.Basic)
		return model.Auth{Type: "basic", Username: c.conv(p["username"]), Password: c.conv(p["password"])}
	case "apikey":
		p := authParams(a.APIKey)
		if p["in"] != "query" {
			return model.Auth{Type: "apiKey", Header: p["key"], Value: c.conv(p["value"])}
		}
		c.colAuth, c.colQuery = nil, a // not a server sign-in: every request gets the query parameter instead
	case "noauth", "inherit", "":
	default:
		c.warns = append(c.warns, fmt.Sprintf("The collection uses %s sign-in, which ndswarm does not support. Set up the sign-in on the server by hand.", a.Type))
	}
	return model.Auth{Type: "none"}
}

// requestAuth adds a folder or request sign-in that differs from the collection's as a header or query row.
func (c *pm) requestAuth(s *model.Step, a *pmAuth, where string) {
	switch a.Type {
	case "bearer":
		s.Headers = append(s.Headers, model.KV{Key: "Authorization", Value: "Bearer " + c.conv(authParams(a.Bearer)["token"]), Enabled: true})
	case "basic":
		p := authParams(a.Basic)
		s.Headers = append(s.Headers, model.KV{Key: "Authorization",
			Value: fmt.Sprintf("Basic {{base64 (print %s %q %s)}}", c.expr(p["username"]), ":", c.expr(p["password"])), Enabled: true})
	case "apikey":
		p := authParams(a.APIKey)
		kv := model.KV{Key: p["key"], Value: c.conv(p["value"]), Enabled: true}
		if p["in"] == "query" {
			s.Query = append(s.Query, kv)
		} else {
			s.Headers = append(s.Headers, kv)
		}
	case "noauth":
		if c.colAuth != nil && c.colAuth.Type != "noauth" {
			c.warns = append(c.warns, fmt.Sprintf("Request %q turns sign-in off in Postman, but here the server sign-in applies to every request.", where))
		}
	default:
		c.warns = append(c.warns, fmt.Sprintf("Request %q uses %s sign-in, which was not imported.", where, a.Type))
	}
}

func (c *pm) body(pb *pmBody, contentType, where string) model.Body {
	b := model.Body{Type: "none", VariantPick: "roundRobin", Variants: []model.Variant{}}
	v := model.Variant{ID: newID(), Name: "body", Weight: 1, Enabled: true, Mode: "fields", Fields: []model.Field{}}
	form := func(kvs []pmKV) {
		for _, kv := range kvs {
			if kv.Disabled || kv.Key == "" {
				continue
			}
			if kv.Type == "file" {
				c.warns = append(c.warns, fmt.Sprintf("Request %q: the file field %q was skipped (file uploads are not supported).", where, kv.Key))
				continue
			}
			v.Fields = append(v.Fields, model.Field{Key: kv.Key, Type: "string", Value: c.conv(str(kv.Value))})
		}
	}
	switch pb.Mode {
	case "raw":
		if strings.TrimSpace(pb.Raw) == "" {
			return b
		}
		isJSON := pb.Options.Raw.Language == "json" || strings.Contains(strings.ToLower(contentType), "json") || json.Valid([]byte(pb.Raw))
		if !isJSON {
			if contentType == "" {
				contentType = rawTypes[pb.Options.Raw.Language]
			}
			b.Type, b.ContentType = "raw", contentType
			v.Mode, v.Raw = "raw", c.conv(pb.Raw)
			break
		}
		b.Type = "json"
		if fields, ok := c.jsonFields(pb.Raw); ok {
			v.Fields = fields
			step := model.Step{Name: "x", Method: "POST", URL: "/", Query: []model.KV{}, Headers: []model.KV{}, TimeoutMs: 1,
				Body: model.Body{Type: "json", VariantPick: "roundRobin", Variants: []model.Variant{v}}}
			if model.ValidateStep(step) == nil {
				break
			}
		}
		v.Mode, v.Fields, v.Raw = "raw", []model.Field{}, c.conv(pb.Raw)
	case "urlencoded":
		b.Type = "form"
		form(pb.URLEncoded)
	case "formdata":
		b.Type = "multipart"
		form(pb.FormData)
	case "graphql":
		if pb.GraphQL == nil {
			return b
		}
		vars := strings.TrimSpace(pb.GraphQL.Variables)
		if vars == "" {
			vars = "{}"
		}
		b.Type = "json"
		v.Mode = "raw"
		q, _ := json.Marshal(pb.GraphQL.Query)
		v.Raw = c.conv(fmt.Sprintf("{\n  \"query\": %s,\n  \"variables\": %s\n}", q, vars))
	default:
		return b
	}
	if v.Mode == "fields" && len(v.Fields) == 0 {
		return model.Body{Type: "none", VariantPick: "roundRobin", Variants: []model.Variant{}}
	}
	b.Variants = []model.Variant{v}
	return b
}

// jsonFields turns a JSON object into typed fields, keeping key order. ok is false for
// anything that is not an object.
func (c *pm) jsonFields(raw string) ([]model.Field, bool) {
	dec := json.NewDecoder(strings.NewReader(raw))
	dec.UseNumber()
	f, err := c.jsonField(dec, 0)
	if err != nil || f.Type != "object" || dec.More() {
		return nil, false
	}
	return f.Children, true
}

// jsonFieldMaxDepth stops runaway recursion on a maliciously nested body (e.g. "[[[...]]]"
// repeated to fill the 20MB upload limit), which would otherwise crash the server with a
// stack overflow. It is well above model.MaxFieldDepth, so any body this deep is going to
// fail validation anyway and fall back to a raw body.
const jsonFieldMaxDepth = 64

func (c *pm) jsonField(dec *json.Decoder, depth int) (model.Field, error) {
	if depth > jsonFieldMaxDepth {
		return model.Field{}, errors.New("too deeply nested")
	}
	tok, err := dec.Token()
	if err != nil {
		return model.Field{}, err
	}
	switch t := tok.(type) {
	case json.Delim:
		if t == '{' {
			f := model.Field{Type: "object", Children: []model.Field{}}
			for dec.More() {
				k, err := dec.Token()
				if err != nil {
					return f, err
				}
				child, err := c.jsonField(dec, depth+1)
				if err != nil {
					return f, err
				}
				child.Key = k.(string)
				f.Children = append(f.Children, child)
			}
			_, err := dec.Token()
			return f, err
		}
		f := model.Field{Type: "array", Children: []model.Field{}}
		n := 0
		for dec.More() {
			item, err := c.jsonField(dec, depth+1)
			if err != nil {
				return f, err
			}
			if n == 0 {
				f.Children = append(f.Children, item)
			}
			n++
		}
		if n == 0 {
			f.Children = []model.Field{{Type: "string"}}
		}
		f.ArrayLen = &model.MinMax{Min: n, Max: n}
		_, err := dec.Token()
		return f, err
	case json.Number:
		if _, err := t.Int64(); err == nil {
			return model.Field{Type: "integer", Value: t.String()}, nil
		}
		return model.Field{Type: "number", Value: t.String()}, nil
	case bool:
		return model.Field{Type: "boolean", Value: strconv.FormatBool(t)}, nil
	case nil:
		return model.Field{Type: "null"}, nil
	default:
		return model.Field{Type: "string", Value: c.conv(t.(string))}, nil
	}
}

// kvs reads headers: a list of {key, value, disabled} or a "Key: value" block (v2.0).
func kvs(raw json.RawMessage) []pmKV {
	var list []pmKV
	if json.Unmarshal(raw, &list) == nil {
		return list
	}
	var s string
	json.Unmarshal(raw, &s)
	for _, line := range strings.Split(s, "\n") {
		if k, v, ok := strings.Cut(line, ":"); ok {
			list = append(list, pmKV{Key: strings.TrimSpace(k), Value: strings.TrimSpace(v)})
		}
	}
	return list
}

// text reads a description, which is a string or {content}.
func text(raw json.RawMessage) string {
	var s string
	if json.Unmarshal(raw, &s) == nil {
		return s
	}
	var d struct {
		Content string `json:"content"`
	}
	json.Unmarshal(raw, &d)
	return d.Content
}

// str prints a Postman value, which may be a string, number or bool.
func str(v any) string {
	switch t := v.(type) {
	case nil:
		return ""
	case string:
		return t
	case float64:
		return strconv.FormatFloat(t, 'f', -1, 64)
	default:
		b, _ := json.Marshal(t)
		return string(b)
	}
}

// strOrList reads a host or path, which is "a.b" / "a/b" or a list of strings or {value} objects.
func strOrList(raw json.RawMessage) []string {
	var s string
	if json.Unmarshal(raw, &s) == nil {
		return []string{s}
	}
	var list []any
	json.Unmarshal(raw, &list)
	out := []string{}
	for _, v := range list {
		if m, ok := v.(map[string]any); ok {
			v = m["value"]
		}
		out = append(out, str(v))
	}
	return out
}
