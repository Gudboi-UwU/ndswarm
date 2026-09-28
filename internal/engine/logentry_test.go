package engine

import (
	"net/http"
	"strings"
	"testing"

	"github.com/Gudboi-UwU/ndswarm/internal/model"
	"github.com/Gudboi-UwU/ndswarm/internal/tmpl"
)

func TestEntryRedactsAndTruncates(t *testing.T) {
	env := &model.Environment{Variables: []model.EnvVar{{Key: "token", Value: "s3cr3t-token", Secret: true}}}
	p := &Plan{Settings: model.Settings{CaptureBodies: true}, redact: NewRedactor(env.SecretValues())}
	c := tmpl.NewCtx(1, nil, nil)
	req := &Request{
		Method: "POST",
		URL:    "http://api/x?key=s3cr3t-token",
		Header: http.Header{"Authorization": {"Bearer abc"}, "X-Api-Key": {"k"}, "Cookie": {"a=b"}, "X-Trace": {"s3cr3t-token"}},
		Body:   []byte(`{"token":"s3cr3t-token","pad":"` + strings.Repeat("a", 20000) + `"}`),
	}
	res := Result{Status: 200, Header: http.Header{"Set-Cookie": {"sid=1"}}, Body: []byte(strings.Repeat("b", 70000)), BytesIn: 70000}
	e := p.entry(c, 0, 0, "sample", "", req, res)

	if strings.Contains(e.Request.URL, "s3cr3t") || e.Request.Headers.Get("X-Trace") != Redacted {
		t.Errorf("secret value leaked: %s %v", e.Request.URL, e.Request.Headers)
	}
	for _, h := range []string{"Authorization", "X-Api-Key", "Cookie"} {
		if e.Request.Headers.Get(h) != Redacted {
			t.Errorf("%s not redacted", h)
		}
	}
	if e.Response.Headers.Get("Set-Cookie") != Redacted {
		t.Error("Set-Cookie not redacted")
	}
	if strings.Contains(e.Request.Body, "s3cr3t") || !strings.Contains(e.Request.Body, `"token":"***"`) {
		t.Error("secret in body not redacted")
	}
	if len(e.Request.Body) != MaxLoggedRequestBody || !e.Request.Truncated || e.Request.BodySize != len(req.Body) {
		t.Errorf("request body %d truncated=%v size=%d", len(e.Request.Body), e.Request.Truncated, e.Request.BodySize)
	}
	if len(e.Response.Body) != MaxLoggedResponseBody || !e.Response.Truncated {
		t.Errorf("response body %d truncated=%v", len(e.Response.Body), e.Response.Truncated)
	}

	p.Settings.CaptureBodies = false
	if e := p.entry(c, 0, 0, "sample", "", req, res); e.Request.Body != "" || e.Response.Body != "" {
		t.Error("bodies captured although captureBodies is off")
	}
}
