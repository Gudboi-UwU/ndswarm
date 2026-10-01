// Package engine turns test steps into HTTP requests and sends them.
package engine

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"math"
	"mime/multipart"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/Gudboi-UwU/ndswarm/internal/model"
	"github.com/Gudboi-UwU/ndswarm/internal/tmpl"
)

// Step is a model.Step with every template compiled and the environment merged in.
type Step struct {
	Name        string
	method      string
	baseURL     string
	url         *tmpl.Template
	query       []kv
	envHeaders  []kv // applied first, then auth, then step headers: later wins
	auth        *auth
	headers     []kv
	bodyType    string
	contentType string
	Variants    []Variant // enabled variants only
	Pick        string
}

type Variant struct {
	ID, Name string
	Weight   int
	raw      *tmpl.Template
	fields   []field
}

type kv struct {
	key   string
	value *tmpl.Template
}

type field struct {
	key      string
	typ      string
	value    *tmpl.Template
	children []field
	min, max int
}

type auth struct {
	kind               string
	header             string
	token, user, value *tmpl.Template
}

// Compile prepares s for rendering. env may be nil (absolute URLs only).
func Compile(s model.Step, env *model.Environment) (*Step, error) {
	c := compiler{}
	st := &Step{
		Name:        s.Name,
		method:      s.Method,
		url:         c.tmpl("url", s.URL),
		bodyType:    s.Body.Type,
		contentType: s.Body.ContentType,
		Pick:        s.Body.VariantPick,
	}
	if env != nil {
		st.baseURL = strings.TrimRight(env.BaseURL, "/")
		for _, h := range env.Headers {
			st.envHeaders = append(st.envHeaders, kv{h.Key, c.tmpl("environment header "+h.Key, h.Value)})
		}
		switch a := env.Auth; a.Type {
		case "bearer":
			st.auth = &auth{kind: a.Type, token: c.tmpl("auth token", a.Token)}
		case "basic":
			st.auth = &auth{kind: a.Type, user: c.tmpl("auth username", a.Username), value: c.tmpl("auth password", a.Password)}
		case "apiKey":
			st.auth = &auth{kind: a.Type, header: a.Header, value: c.tmpl("auth key", a.Value)}
		}
	}
	for _, q := range s.Query {
		if q.Enabled {
			st.query = append(st.query, kv{q.Key, c.tmpl("query "+q.Key, q.Value)})
		}
	}
	for _, h := range s.Headers {
		if h.Enabled {
			st.headers = append(st.headers, kv{h.Key, c.tmpl("header "+h.Key, h.Value)})
		}
	}
	if s.Body.Type != "none" {
		for _, v := range s.Body.Variants {
			if !v.Enabled {
				continue
			}
			cv := Variant{ID: v.ID, Name: v.Name, Weight: v.Weight}
			if v.Mode == "raw" {
				cv.raw = c.tmpl("body "+v.Name, v.Raw)
			} else {
				cv.fields = c.fields(v.Fields)
			}
			st.Variants = append(st.Variants, cv)
		}
	}
	return st, c.err
}

type compiler struct{ err error }

func (c *compiler) tmpl(what, src string) *tmpl.Template {
	t, err := tmpl.Compile(src)
	if err != nil && c.err == nil {
		c.err = fmt.Errorf("%s: %w", what, err)
	}
	return t
}

func (c *compiler) fields(fs []model.Field) []field {
	out := make([]field, 0, len(fs))
	for _, f := range fs {
		if !f.IsEnabled() {
			continue
		}
		cf := field{key: f.Key, typ: f.Type}
		switch f.Type {
		case "object", "array":
			cf.children = c.fields(f.Children)
			if f.ArrayLen != nil {
				cf.min, cf.max = f.ArrayLen.Min, f.ArrayLen.Max
			}
		case "null":
		default:
			cf.value = c.tmpl("field "+f.Key, f.Value)
		}
		out = append(out, cf)
	}
	return out
}

// Request is a rendered step, ready to send and to show in the UI.
type Request struct {
	Method  string      `json:"method"`
	URL     string      `json:"url"`
	Header  http.Header `json:"headers"`
	Body    []byte      `json:"-"`
	Variant string      `json:"variant,omitempty"`
}

// TemplateError marks failures while rendering, so they are counted as "template" errors.
type TemplateError struct{ Err error }

func (e TemplateError) Error() string { return e.Err.Error() }
func (e TemplateError) Unwrap() error { return e.Err }

// Render produces one request using variant index vi (ignored when the step has no body).
func (s *Step) Render(c *tmpl.Ctx, vi int) (*Request, error) {
	r, err := s.render(c, vi)
	if err != nil {
		return nil, TemplateError{err}
	}
	return r, nil
}

func (s *Step) render(c *tmpl.Ctx, vi int) (*Request, error) {
	raw, err := s.url.Execute(c)
	if err != nil {
		return nil, fmt.Errorf("url: %w", err)
	}
	u, err := s.resolve(raw)
	if err != nil {
		return nil, err
	}
	if len(s.query) > 0 {
		q := u.Query()
		for _, p := range s.query {
			v, err := p.value.Execute(c)
			if err != nil {
				return nil, fmt.Errorf("query %s: %w", p.key, err)
			}
			q.Add(p.key, v)
		}
		u.RawQuery = q.Encode()
	}

	r := &Request{Method: s.method, URL: u.String(), Header: http.Header{}}
	for _, h := range s.envHeaders {
		if err := setHeader(r.Header, h, c); err != nil {
			return nil, err
		}
	}
	if err := s.applyAuth(r.Header, c); err != nil {
		return nil, err
	}
	for _, h := range s.headers {
		if err := setHeader(r.Header, h, c); err != nil {
			return nil, err
		}
	}

	if len(s.Variants) == 0 {
		return r, nil
	}
	v := s.Variants[vi%len(s.Variants)]
	r.Variant = v.Name
	ct, body, err := s.body(v, c)
	if err != nil {
		return nil, fmt.Errorf("body %s: %w", v.Name, err)
	}
	r.Body = body
	if r.Header.Get("Content-Type") == "" {
		r.Header.Set("Content-Type", ct)
	}
	return r, nil
}

func (s *Step) resolve(raw string) (*url.URL, error) {
	return ResolveURL(raw, s.baseURL)
}

// ResolveURL builds the final request URL from a rendered template result and the environment's
// base URL (empty when the test has no environment, or the environment has no address).
func ResolveURL(raw, baseURL string) (*url.URL, error) {
	raw = strings.TrimSpace(raw)
	if !strings.HasPrefix(raw, "http://") && !strings.HasPrefix(raw, "https://") {
		if baseURL == "" {
			return nil, fmt.Errorf("url %q is relative but the environment has no base URL", raw)
		}
		raw = strings.TrimRight(baseURL, "/") + "/" + strings.TrimLeft(raw, "/")
	}
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return nil, fmt.Errorf("url %q is not valid", raw)
	}
	return u, nil
}

func setHeader(h http.Header, p kv, c *tmpl.Ctx) error {
	v, err := p.value.Execute(c)
	if err != nil {
		return fmt.Errorf("header %s: %w", p.key, err)
	}
	h.Set(p.key, v)
	return nil
}

func (s *Step) applyAuth(h http.Header, c *tmpl.Ctx) error {
	a := s.auth
	if a == nil {
		return nil
	}
	switch a.kind {
	case "bearer":
		tok, err := a.token.Execute(c)
		if err != nil {
			return fmt.Errorf("auth token: %w", err)
		}
		h.Set("Authorization", "Bearer "+tok)
	case "basic":
		user, err := a.user.Execute(c)
		if err != nil {
			return fmt.Errorf("auth username: %w", err)
		}
		pass, err := a.value.Execute(c)
		if err != nil {
			return fmt.Errorf("auth password: %w", err)
		}
		h.Set("Authorization", "Basic "+base64.StdEncoding.EncodeToString([]byte(user+":"+pass)))
	case "apiKey":
		v, err := a.value.Execute(c)
		if err != nil {
			return fmt.Errorf("auth key: %w", err)
		}
		h.Set(a.header, v)
	}
	return nil
}

func (s *Step) body(v Variant, c *tmpl.Ctx) (contentType string, body []byte, err error) {
	switch s.bodyType {
	case "json":
		if v.raw != nil {
			out, err := v.raw.Execute(c)
			return "application/json", []byte(out), err
		}
		var b bytes.Buffer
		err := writeObject(&b, v.fields, c)
		return "application/json", b.Bytes(), err
	case "raw":
		out, err := v.raw.Execute(c)
		ct := s.contentType
		if ct == "" {
			ct = "text/plain; charset=utf-8"
		}
		return ct, []byte(out), err
	case "form":
		form := url.Values{}
		for _, f := range v.fields {
			val, err := scalar(f, c)
			if err != nil {
				return "", nil, err
			}
			form.Add(f.key, val)
		}
		return "application/x-www-form-urlencoded", []byte(form.Encode()), nil
	case "multipart":
		var b bytes.Buffer
		w := multipart.NewWriter(&b)
		for _, f := range v.fields {
			val, err := scalar(f, c)
			if err != nil {
				return "", nil, err
			}
			w.WriteField(f.key, val)
		}
		w.Close()
		return w.FormDataContentType(), b.Bytes(), nil
	}
	return "", nil, fmt.Errorf("unknown body type %q", s.bodyType)
}

// writeObject writes fields as a JSON object in the order the user defined them.
func writeObject(b *bytes.Buffer, fields []field, c *tmpl.Ctx) error {
	b.WriteByte('{')
	for i, f := range fields {
		if i > 0 {
			b.WriteByte(',')
		}
		k, _ := json.Marshal(f.key)
		b.Write(k)
		b.WriteByte(':')
		if err := writeValue(b, f, c); err != nil {
			return err
		}
	}
	b.WriteByte('}')
	return nil
}

func writeValue(b *bytes.Buffer, f field, c *tmpl.Ctx) error {
	switch f.typ {
	case "object":
		return writeObject(b, f.children, c)
	case "array":
		n := f.min
		if f.max > f.min {
			n += c.Rand.IntN(f.max - f.min + 1)
		}
		b.WriteByte('[')
		for i := range n {
			if i > 0 {
				b.WriteByte(',')
			}
			if len(f.children) > 0 {
				if err := writeValue(b, f.children[0], c); err != nil {
					return err
				}
			} else {
				b.WriteString("null")
			}
		}
		b.WriteByte(']')
		return nil
	case "null":
		b.WriteString("null")
		return nil
	}
	s, err := f.value.Execute(c)
	if err != nil {
		return fmt.Errorf("%s: %w", f.key, err)
	}
	out, err := Typed(f.key, f.typ, s)
	if err != nil {
		return err
	}
	b.Write(out)
	return nil
}

// Typed converts rendered text to the field's JSON type, so an integer field is never "42".
func Typed(key, typ, s string) ([]byte, error) {
	t := strings.TrimSpace(s)
	switch typ {
	case "string":
		return json.Marshal(s)
	case "integer":
		if _, err := strconv.ParseInt(t, 10, 64); err == nil {
			return []byte(t), nil
		}
		if f, err := strconv.ParseFloat(t, 64); err == nil && f == float64(int64(f)) {
			return []byte(strconv.FormatInt(int64(f), 10)), nil
		}
		return nil, fmt.Errorf("%s: %q is not an integer", key, s)
	case "number":
		if f, err := strconv.ParseFloat(t, 64); err == nil && !isInfNaN(f) {
			return []byte(strconv.FormatFloat(f, 'f', -1, 64)), nil
		}
		return nil, fmt.Errorf("%s: %q is not a number", key, s)
	case "boolean":
		v, err := strconv.ParseBool(t)
		if err != nil {
			return nil, fmt.Errorf("%s: %q is not true or false", key, s)
		}
		return []byte(strconv.FormatBool(v)), nil
	}
	return nil, fmt.Errorf("%s: unknown type %q", key, typ)
}

func isInfNaN(f float64) bool { return math.IsInf(f, 0) || math.IsNaN(f) }

// scalar renders a flat (form/multipart) field as text, checking its declared type.
func scalar(f field, c *tmpl.Ctx) (string, error) {
	if f.typ == "null" {
		return "", nil
	}
	s, err := f.value.Execute(c)
	if err != nil {
		return "", fmt.Errorf("%s: %w", f.key, err)
	}
	if f.typ == "string" {
		return s, nil
	}
	out, err := Typed(f.key, f.typ, s)
	return string(out), err
}

// EnvVars renders the environment's variables once, for use as {{var "name"}}.
func EnvVars(env *model.Environment, c *tmpl.Ctx) (map[string]string, error) {
	vars := map[string]string{}
	if env == nil {
		return vars, nil
	}
	for _, v := range env.Variables {
		t, err := tmpl.Compile(v.Value)
		if err != nil {
			return nil, fmt.Errorf("variable %s: %w", v.Key, err)
		}
		out, err := t.Execute(c)
		if err != nil {
			return nil, fmt.Errorf("variable %s: %w", v.Key, err)
		}
		vars[v.Key] = out
		c.Vars[v.Key] = out // later variables may reference earlier ones
	}
	return vars, nil
}
