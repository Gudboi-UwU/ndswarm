package engine

import (
	"time"
	"unicode/utf8"

	"github.com/Gudboi-UwU/ndswarm/internal/logsink"
	"github.com/Gudboi-UwU/ndswarm/internal/tmpl"
)

// Body limits for logged requests and responses.
const (
	MaxLoggedRequestBody  = 16 << 10
	MaxLoggedResponseBody = 64 << 10
)

// entry builds a redacted log entry. req is nil when rendering failed.
func (p *Plan) entry(c *tmpl.Ctx, key int, sec int64, reason, msg string, req *Request, res Result) *logsink.Entry {
	red := p.redact
	e := &logsink.Entry{
		TMs: time.Now().UnixMilli(), Sec: sec, VU: c.VU, Iter: c.Iter, Key: key,
		Status: res.Status, Category: res.Category, LatencyMs: res.Timing.Total, Reason: reason,
		Error: msg, // already redacted by the caller
		Timing: logsink.Timing{DNS: res.Timing.DNS, Connect: res.Timing.Connect, TLS: res.Timing.TLS,
			TTFB: res.Timing.TTFB, Download: res.Timing.Download, Total: res.Timing.Total, Reused: res.Timing.Reused},
	}
	if req != nil {
		lr := &logsink.Request{Method: req.Method, URL: red.String(req.URL), Headers: red.Header(req.Header), BodySize: len(req.Body)}
		if p.Settings.CaptureBodies {
			lr.Body, lr.Truncated = clip(red.String(string(req.Body)), MaxLoggedRequestBody)
		}
		e.Request = lr
	}
	if res.Status != 0 {
		lr := &logsink.Response{Status: res.Status, Headers: red.Header(res.Header), BodySize: res.BytesIn}
		if p.Settings.CaptureBodies {
			lr.Body, lr.Truncated = clip(red.String(string(res.Body)), MaxLoggedResponseBody)
			lr.Truncated = lr.Truncated || int64(len(res.Body)) < res.BytesIn
		}
		e.Response = lr
	}
	return e
}

// clip cuts s to at most n bytes on a rune boundary; binary data becomes a placeholder.
func clip(s string, n int) (string, bool) {
	cut := len(s) > n
	if cut {
		s = s[:n]
		for len(s) > 0 && !utf8.ValidString(s) && len(s) > n-4 {
			s = s[:len(s)-1]
		}
	}
	if !utf8.ValidString(s) {
		return "[binary body]", cut
	}
	return s, cut
}
