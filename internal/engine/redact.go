package engine

import (
	"net/http"
	"strings"
)

// Redacted replaces secrets in anything stored or shown (Try output, request logs).
const Redacted = "***"

var sensitiveHeaders = []string{"Authorization", "Proxy-Authorization", "Cookie", "Set-Cookie", "X-Api-Key"}

// Redactor hides secret values and sensitive headers.
type Redactor struct{ r *strings.Replacer }

// NewRedactor masks every given secret value (empty and very short values are ignored:
// masking "a" would shred unrelated text).
func NewRedactor(secrets []string) Redactor {
	var pairs []string
	for _, s := range secrets {
		if len(s) >= 4 {
			pairs = append(pairs, s, Redacted)
		}
	}
	return Redactor{strings.NewReplacer(pairs...)}
}

func (r Redactor) String(s string) string { return r.r.Replace(s) }

// Header returns a copy of h with sensitive headers and secret values masked.
func (r Redactor) Header(h http.Header) http.Header {
	out := make(http.Header, len(h))
	for k, vs := range h {
		masked := make([]string, len(vs))
		for i, v := range vs {
			masked[i] = r.String(v)
		}
		out[k] = masked
	}
	for _, k := range sensitiveHeaders {
		if len(out.Values(k)) > 0 {
			out.Set(k, Redacted)
		}
	}
	return out
}
