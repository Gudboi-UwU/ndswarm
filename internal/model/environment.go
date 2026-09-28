package model

import (
	"fmt"
	"net/url"
	"regexp"
	"strings"
)

// Masked replaces secret values in API responses. Sending it back unchanged keeps the stored value.
const Masked = "••••••••"

// Environment is a target (base URL) plus variables, default headers and auth for a project.
type Environment struct {
	ID        int64    `json:"id"`
	ProjectID int64    `json:"projectId"`
	Name      string   `json:"name"`
	BaseURL   string   `json:"baseUrl"`
	Variables []EnvVar `json:"variables"`
	Headers   []EnvVar `json:"headers"`
	Auth      Auth     `json:"auth"`
}

type EnvVar struct {
	Key    string `json:"key"`
	Value  string `json:"value"`
	Secret bool   `json:"secret"`
}

// Auth adds one header to every request. Token, Password and Value are always secret.
type Auth struct {
	Type     string `json:"type"` // none | bearer | basic | apiKey
	Token    string `json:"token,omitempty"`
	Username string `json:"username,omitempty"`
	Password string `json:"password,omitempty"`
	Header   string `json:"header,omitempty"` // apiKey header name
	Value    string `json:"value,omitempty"`
}

var varName = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)

func (e *Environment) Normalize() {
	e.BaseURL = strings.TrimSpace(e.BaseURL)
	if e.Variables == nil {
		e.Variables = []EnvVar{}
	}
	if e.Headers == nil {
		e.Headers = []EnvVar{}
	}
	if e.Auth.Type == "" {
		e.Auth.Type = "none"
	}
}

func (e *Environment) Validate() error {
	var v ValidationError
	checkName(&v, "name", e.Name)
	if e.BaseURL != "" {
		u, err := url.Parse(e.BaseURL)
		v.Check(err == nil && (u.Scheme == "http" || u.Scheme == "https") && u.Host != "", "baseUrl",
			"Use a full URL like https://api.example.com, or leave it empty.")
	}
	seen := map[string]bool{}
	for i, kv := range e.Variables {
		p := fmt.Sprintf("variables.%d", i)
		v.Check(varName.MatchString(kv.Key), p+".key", "Use letters, digits and _ (not starting with a digit).")
		v.Check(!seen[kv.Key], p+".key", "Duplicate name.")
		seen[kv.Key] = true
		checkTemplate(&v, p+".value", kv.Value)
	}
	for i, kv := range e.Headers {
		p := fmt.Sprintf("headers.%d", i)
		v.Check(headerToken.MatchString(kv.Key), p+".key", "Enter a valid header name.")
		checkTemplate(&v, p+".value", kv.Value)
	}
	a := e.Auth
	switch a.Type {
	case "none":
	case "bearer":
		v.Check(a.Token != "", "auth.token", "Enter a token.")
		checkTemplate(&v, "auth.token", a.Token)
	case "basic":
		v.Check(a.Username != "", "auth.username", "Enter a username.")
		checkTemplate(&v, "auth.username", a.Username)
		checkTemplate(&v, "auth.password", a.Password)
	case "apiKey":
		v.Check(headerToken.MatchString(a.Header), "auth.header", "Enter a valid header name.")
		v.Check(a.Value != "", "auth.value", "Enter the key.")
		checkTemplate(&v, "auth.value", a.Value)
	default:
		v.Check(false, "auth.type", "Choose none, bearer, basic or apiKey.")
	}
	return v.Err()
}

// secrets visits every secret value so Mask, KeepSecrets and encryption share one list.
func (e *Environment) secrets(fn func(key string, value *string)) {
	for i := range e.Variables {
		if e.Variables[i].Secret {
			fn("var:"+e.Variables[i].Key, &e.Variables[i].Value)
		}
	}
	for i := range e.Headers {
		if e.Headers[i].Secret {
			fn("header:"+strings.ToLower(e.Headers[i].Key), &e.Headers[i].Value)
		}
	}
	switch e.Auth.Type {
	case "bearer":
		fn("auth:token", &e.Auth.Token)
	case "basic":
		fn("auth:password", &e.Auth.Password)
	case "apiKey":
		fn("auth:value", &e.Auth.Value)
	}
}

// Mask hides secret values (for API responses).
func (e *Environment) Mask() {
	e.secrets(func(_ string, v *string) {
		if *v != "" {
			*v = Masked
		}
	})
}

// KeepSecrets restores values the client sent back as Masked from the stored version.
func (e *Environment) KeepSecrets(stored *Environment) {
	old := map[string]string{}
	stored.secrets(func(k string, v *string) { old[k] = *v })
	e.secrets(func(k string, v *string) {
		if *v == Masked {
			*v = old[k]
		}
	})
}

// MapSecrets rewrites every secret value, e.g. to encrypt or decrypt it.
func (e *Environment) MapSecrets(fn func(string) (string, error)) error {
	var firstErr error
	e.secrets(func(_ string, v *string) {
		if *v == "" || firstErr != nil {
			return
		}
		out, err := fn(*v)
		if err != nil {
			firstErr = err
			return
		}
		*v = out
	})
	return firstErr
}

// SecretValues lists the plain secret values, for redaction.
func (e *Environment) SecretValues() []string {
	var out []string
	e.secrets(func(_ string, v *string) { out = append(out, *v) })
	return out
}

// SecretVar reports whether variable key is marked secret.
func (e *Environment) SecretVar(key string) bool {
	for _, v := range e.Variables {
		if v.Key == key {
			return v.Secret
		}
	}
	return false
}
