package importer

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"github.com/Gudboi-UwU/ndswarm/internal/model"
)

const postmanSchema = "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"

type pmOut struct {
	Info     pmOutInfo   `json:"info"`
	Item     []pmOutItem `json:"item"`
	Variable []pmOutKV   `json:"variable,omitempty"`
	Auth     *pmOutAuth  `json:"auth,omitempty"`
}

type pmOutInfo struct {
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	Schema      string `json:"schema"`
}

type pmOutItem struct {
	Name        string      `json:"name"`
	Description string      `json:"description,omitempty"`
	Item        []pmOutItem `json:"item,omitempty"`
	Request     *pmOutReq   `json:"request,omitempty"`
	Auth        *pmOutAuth  `json:"auth,omitempty"`
}

type pmOutReq struct {
	Method      string     `json:"method"`
	Header      []pmOutKV  `json:"header"`
	Body        *pmOutBody `json:"body,omitempty"`
	URL         pmOutURL   `json:"url"`
	Description string     `json:"description,omitempty"`
}

type pmOutURL struct {
	Raw   string    `json:"raw"`
	Query []pmOutKV `json:"query,omitempty"`
}

type pmOutKV struct {
	Key      string `json:"key"`
	Value    string `json:"value"`
	Type     string `json:"type,omitempty"`
	Disabled bool   `json:"disabled,omitempty"`
}

type pmOutBody struct {
	Mode       string    `json:"mode"`
	Raw        string    `json:"raw,omitempty"`
	URLEncoded []pmOutKV `json:"urlencoded,omitempty"`
	FormData   []pmOutKV `json:"formdata,omitempty"`
	Options    any       `json:"options,omitempty"`
}

type pmOutAuth struct {
	Type   string    `json:"type"`
	Bearer []pmOutKV `json:"bearer,omitempty"`
	Basic  []pmOutKV `json:"basic,omitempty"`
	APIKey []pmOutKV `json:"apikey,omitempty"`
}

// reverse maps generators to Postman dynamic variables (arguments are dropped).
var reverse = map[string]string{
	"uuid": "$randomUUID", "timestamp": "$timestamp", "now": "$isoTimestamp", "int": "$randomInt",
	"email": "$randomEmail", "firstName": "$randomFirstName", "lastName": "$randomLastName", "name": "$randomFullName",
	"username": "$randomUserName", "password": "$randomPassword", "phone": "$randomPhoneNumber", "city": "$randomCity",
	"country": "$randomCountry", "company": "$randomCompanyName", "jobTitle": "$randomJobTitle", "address": "$randomStreetAddress",
	"url": "$randomUrl", "ipv4": "$randomIP", "sentence": "$randomLoremSentence", "paragraph": "$randomLoremParagraphs", "bool": "$randomBoolean",
}

var (
	action  = regexp.MustCompile(`\{\{("(?:[^"\\]|\\.)*"|[^{}]*)\}\}`)
	varCall = regexp.MustCompile(`^var\s+"([^"]*)"$`)
)

// exporter converts templates to Postman text and remembers what had no match.
type exporter struct{ unmapped []string }

func (x *exporter) text(s string) string {
	return action.ReplaceAllStringFunc(s, func(m string) string {
		inner := strings.TrimSpace(m[2 : len(m)-2])
		if u, err := strconv.Unquote(inner); err == nil && strings.HasPrefix(inner, `"`) {
			return u
		}
		if v := varCall.FindStringSubmatch(inner); v != nil {
			return "{{" + v[1] + "}}"
		}
		if f := strings.Fields(inner); len(f) > 0 && reverse[f[0]] != "" {
			return "{{" + reverse[f[0]] + "}}"
		}
		x.unmapped = append(x.unmapped, m)
		return m
	})
}

// Postman encodes the bundle as a Postman v2.1 collection. With folders, each test becomes a folder.
func (b Bundle) Postman(folders bool) ([]byte, error) {
	servers := map[string]Server{}
	for _, s := range b.Servers {
		servers[s.Name] = s
	}
	var main *Server
	for _, t := range b.Tests {
		if s, ok := servers[t.Server]; ok {
			main = &s
			break
		}
	}
	x := &exporter{}
	col := pmOut{Info: pmOutInfo{Name: b.Project.Name, Description: b.Project.Description, Schema: postmanSchema}, Item: []pmOutItem{}}
	if !folders && len(b.Tests) == 1 {
		col.Info.Name, col.Info.Description = b.Tests[0].Name, b.Tests[0].Description
	}
	seen := map[string]bool{}
	addVars := func(s Server) {
		for _, v := range s.Variables {
			if !seen[v.Key] {
				seen[v.Key] = true
				col.Variable = append(col.Variable, pmOutKV{Key: v.Key, Value: x.text(v.Value), Type: "string"})
			}
		}
	}
	if main != nil {
		if main.BaseURL != "" {
			seen["baseUrl"] = true
			col.Variable = append(col.Variable, pmOutKV{Key: "baseUrl", Value: main.BaseURL, Type: "string"})
		}
		addVars(*main)
		col.Auth = x.auth(main.Auth)
	}
	for _, t := range b.Tests {
		s, hasServer := servers[t.Server]
		if hasServer {
			addVars(s)
		}
		base := ""
		if hasServer && s.BaseURL != "" {
			base = s.BaseURL
			if main != nil && s.BaseURL == main.BaseURL {
				base = "{{baseUrl}}"
			}
		}
		var items []pmOutItem
		for _, f := range t.Flows {
			var steps []pmOutItem
			for _, st := range f.Steps {
				steps = append(steps, x.item(st, base, s.Headers))
			}
			if len(steps) == 1 {
				steps[0].Name = f.Name
				items = append(items, steps[0])
			} else {
				items = append(items, pmOutItem{Name: f.Name, Item: steps})
			}
		}
		if !folders {
			col.Item = append(col.Item, items...)
			continue
		}
		if len(items) == 0 {
			continue
		}
		folder := pmOutItem{Name: t.Name, Description: t.Description, Item: items}
		if hasServer && main != nil && s.Auth != main.Auth {
			folder.Auth = x.auth(s.Auth)
		}
		col.Item = append(col.Item, folder)
	}
	return marshal(col)
}

func (x *exporter) auth(a model.Auth) *pmOutAuth {
	switch a.Type {
	case "bearer":
		return &pmOutAuth{Type: "bearer", Bearer: []pmOutKV{{Key: "token", Value: x.text(a.Token), Type: "string"}}}
	case "basic":
		return &pmOutAuth{Type: "basic", Basic: []pmOutKV{{Key: "username", Value: x.text(a.Username), Type: "string"}, {Key: "password", Value: x.text(a.Password), Type: "string"}}}
	case "apiKey":
		return &pmOutAuth{Type: "apikey", APIKey: []pmOutKV{{Key: "key", Value: a.Header, Type: "string"}, {Key: "value", Value: x.text(a.Value), Type: "string"}, {Key: "in", Value: "header", Type: "string"}}}
	}
	return nil
}

func (x *exporter) item(s model.Step, base string, serverHeaders []model.EnvVar) pmOutItem {
	x.unmapped = nil
	u := x.text(s.URL)
	if base != "" && !strings.HasPrefix(s.URL, "http://") && !strings.HasPrefix(s.URL, "https://") && !strings.HasPrefix(s.URL, "{{") {
		u = base + "/" + strings.TrimLeft(u, "/")
	}
	r := &pmOutReq{Method: s.Method, Header: []pmOutKV{}, URL: pmOutURL{Raw: u}}
	var q []string
	for _, kv := range s.Query {
		r.URL.Query = append(r.URL.Query, pmOutKV{Key: kv.Key, Value: x.text(kv.Value), Disabled: !kv.Enabled})
		if kv.Enabled {
			q = append(q, kv.Key+"="+x.text(kv.Value))
		}
	}
	if len(q) > 0 {
		r.URL.Raw += "?" + strings.Join(q, "&")
	}
	for _, h := range serverHeaders {
		r.Header = append(r.Header, pmOutKV{Key: h.Key, Value: x.text(h.Value), Type: "text"})
	}
	hasCT := false
	for _, h := range s.Headers {
		hasCT = hasCT || strings.EqualFold(h.Key, "Content-Type")
		r.Header = append(r.Header, pmOutKV{Key: h.Key, Value: x.text(h.Value), Type: "text", Disabled: !h.Enabled})
	}
	var notes []string
	var v *model.Variant
	for i := range s.Body.Variants {
		if s.Body.Variants[i].Enabled && v == nil {
			v = &s.Body.Variants[i]
		}
	}
	if s.Body.Type != "none" && v != nil {
		if n := len(s.Body.Variants); n > 1 {
			notes = append(notes, fmt.Sprintf("Only the body variant %q was exported (the test has %d).", v.Name, n))
		}
		r.Body = x.body(s.Body, *v)
		if s.Body.Type == "raw" && s.Body.ContentType != "" && !hasCT {
			r.Header = append(r.Header, pmOutKV{Key: "Content-Type", Value: s.Body.ContentType, Type: "text"})
		}
	}
	if len(x.unmapped) > 0 {
		notes = append(notes, "These ndswarm values have no Postman match and were left as written: "+strings.Join(uniq(x.unmapped), ", "))
	}
	r.Description = strings.Join(notes, "\n")
	return pmOutItem{Name: s.Name, Request: r}
}

func (x *exporter) body(b model.Body, v model.Variant) *pmOutBody {
	jsonOpts := map[string]any{"raw": map[string]string{"language": "json"}}
	switch {
	case v.Mode == "raw" && b.Type == "json":
		return &pmOutBody{Mode: "raw", Raw: x.text(v.Raw), Options: jsonOpts}
	case v.Mode == "raw":
		return &pmOutBody{Mode: "raw", Raw: x.text(v.Raw)}
	case b.Type == "json":
		var sb strings.Builder
		x.object(&sb, v.Fields, "")
		return &pmOutBody{Mode: "raw", Raw: sb.String(), Options: jsonOpts}
	}
	var kvs []pmOutKV
	for _, f := range v.Fields {
		if f.IsEnabled() {
			kvs = append(kvs, pmOutKV{Key: f.Key, Value: x.text(f.Value), Type: "text"})
		}
	}
	if b.Type == "form" {
		return &pmOutBody{Mode: "urlencoded", URLEncoded: kvs}
	}
	return &pmOutBody{Mode: "formdata", FormData: kvs}
}

// object writes fields as JSON text; placeholders in typed values stay unquoted.
func (x *exporter) object(sb *strings.Builder, fields []model.Field, indent string) {
	sb.WriteString("{")
	first := true
	for _, f := range fields {
		if !f.IsEnabled() {
			continue
		}
		if !first {
			sb.WriteString(",")
		}
		first = false
		k, _ := json.Marshal(f.Key)
		sb.WriteString("\n" + indent + "  " + string(k) + ": ")
		x.value(sb, f, indent+"  ")
	}
	if !first {
		sb.WriteString("\n" + indent)
	}
	sb.WriteString("}")
}

func (x *exporter) value(sb *strings.Builder, f model.Field, indent string) {
	switch f.Type {
	case "object":
		x.object(sb, f.Children, indent)
	case "array":
		n := 1
		if f.ArrayLen != nil {
			n = f.ArrayLen.Max
		}
		sb.WriteString("[")
		for i := 0; i < n && len(f.Children) > 0; i++ {
			if i > 0 {
				sb.WriteString(",")
			}
			sb.WriteString("\n" + indent + "  ")
			x.value(sb, f.Children[0], indent+"  ")
		}
		if n > 0 && len(f.Children) > 0 {
			sb.WriteString("\n" + indent)
		}
		sb.WriteString("]")
	case "null":
		sb.WriteString("null")
	case "string":
		if strings.Contains(f.Value, "{{") {
			sb.WriteString(`"` + x.text(f.Value) + `"`)
		} else {
			q, _ := json.Marshal(f.Value)
			sb.Write(q)
		}
	default:
		v := strings.TrimSpace(x.text(f.Value))
		if v == "" {
			v = map[string]string{"boolean": "false"}[f.Type]
			if v == "" {
				v = "0"
			}
		}
		sb.WriteString(v)
	}
}

func uniq(s []string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, v := range s {
		if !seen[v] {
			seen[v] = true
			out = append(out, v)
		}
	}
	return out
}
