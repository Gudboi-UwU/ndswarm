package engine

import (
	"bytes"
	"context"
	"crypto/tls"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptrace"
	"os"
	"strings"
	"syscall"
	"time"
)

// MaxReadBody is how much of a response is kept for extractors, assertions and the UI.
// The rest is drained and only counted.
const MaxReadBody = 10 << 20

// ErrBlockedTarget is returned when a request would reach a link-local address (cloud metadata).
var ErrBlockedTarget = errors.New("target address is blocked: link-local addresses such as 169.254.169.254 are not allowed")

// ErrNotAllowed is returned when a target allowlist is set and the host is not on it.
var ErrNotAllowed = errors.New("target host is not on the allowlist (Settings > Targets)")

// Guard limits where requests may go. The zero value is the safe default:
// link-local (cloud metadata) blocked, any host allowed.
type Guard struct {
	AllowLinkLocal bool
	Allow          []string // hosts; "*.example.com" matches subdomains; empty = any host
}

func (g Guard) allows(host string) bool {
	if len(g.Allow) == 0 {
		return true
	}
	host = strings.ToLower(strings.TrimSuffix(host, "."))
	for _, a := range g.Allow {
		a = strings.ToLower(a)
		if host == a || (strings.HasPrefix(a, "*.") && strings.HasSuffix(host, a[1:])) {
			return true
		}
	}
	return false
}

type ClientOptions struct {
	MaxConnsPerHost int
	HTTP2           bool
	InsecureTLS     bool
	Guard           Guard
}

// NewTransport returns the transport shared by every VU of a run.
// The dial check runs after DNS resolution, so a hostname cannot rebind to a blocked IP.
func NewTransport(o ClientOptions) *http.Transport {
	dialer := &net.Dialer{
		Timeout:   10 * time.Second,
		KeepAlive: 30 * time.Second,
		Control: func(_, address string, _ syscall.RawConn) error {
			host, _, _ := net.SplitHostPort(address)
			if ip := net.ParseIP(host); !o.Guard.AllowLinkLocal && ip != nil && (ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast()) {
				return ErrBlockedTarget
			}
			return nil
		},
	}
	dial := func(ctx context.Context, network, addr string) (net.Conn, error) {
		host, _, _ := net.SplitHostPort(addr) // the hostname, before DNS resolution
		if !o.Guard.allows(host) {
			return nil, ErrNotAllowed
		}
		return dialer.DialContext(ctx, network, addr)
	}
	conns := max(o.MaxConnsPerHost, 10)
	return &http.Transport{
		Proxy:               nil,
		DialContext:         dial,
		ForceAttemptHTTP2:   o.HTTP2,
		MaxIdleConns:        conns * 4,
		MaxIdleConnsPerHost: conns,
		IdleConnTimeout:     90 * time.Second,
		TLSHandshakeTimeout: 10 * time.Second,
		TLSClientConfig:     &tls.Config{InsecureSkipVerify: o.InsecureTLS}, //nolint:gosec // opt-in per test
	}
}

// Client returns an http.Client over t with the step's redirect policy.
func Client(t http.RoundTripper, followRedirects bool) *http.Client {
	c := &http.Client{Transport: t}
	if !followRedirects {
		c.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	}
	return c
}

// Timing is the latency breakdown of one request in milliseconds. Phases are 0 on a reused connection.
type Timing struct {
	DNS      float64 `json:"dns"`
	Connect  float64 `json:"connect"`
	TLS      float64 `json:"tls"`
	TTFB     float64 `json:"ttfb"`     // request sent until first response byte
	Download float64 `json:"download"` // first byte until body fully read
	Total    float64 `json:"total"`
	Reused   bool    `json:"reused"`
}

// Result is one sent request.
type Result struct {
	Status   int
	Header   http.Header
	Body     []byte // first MaxReadBody bytes
	BytesIn  int64
	BytesOut int64
	Timing   Timing
	Err      error
	Category string // "" when the request completed; see Categorize
}

// Send executes r with the given timeout and reads the whole response.
func Send(ctx context.Context, client *http.Client, r *Request, timeout time.Duration) Result {
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	var res Result
	var start, dnsStart, connStart, tlsStart, wrote, firstByte time.Time
	trace := &httptrace.ClientTrace{
		DNSStart:             func(httptrace.DNSStartInfo) { dnsStart = time.Now() },
		DNSDone:              func(httptrace.DNSDoneInfo) { res.Timing.DNS = ms(time.Since(dnsStart)) },
		ConnectStart:         func(string, string) { connStart = time.Now() },
		ConnectDone:          func(string, string, error) { res.Timing.Connect = ms(time.Since(connStart)) },
		TLSHandshakeStart:    func() { tlsStart = time.Now() },
		TLSHandshakeDone:     func(tls.ConnectionState, error) { res.Timing.TLS = ms(time.Since(tlsStart)) },
		GotConn:              func(i httptrace.GotConnInfo) { res.Timing.Reused = i.Reused },
		WroteRequest:         func(httptrace.WroteRequestInfo) { wrote = time.Now() },
		GotFirstResponseByte: func() { firstByte = time.Now() },
	}

	req, err := http.NewRequestWithContext(httptrace.WithClientTrace(ctx, trace), r.Method, r.URL, bytes.NewReader(r.Body))
	if err != nil {
		res.Err, res.Category = err, "template"
		return res
	}
	req.Header = r.Header.Clone()
	if req.Header.Get("User-Agent") == "" {
		req.Header.Set("User-Agent", UserAgent)
	}
	res.BytesOut = int64(len(r.Body))

	start = time.Now()
	resp, err := client.Do(req)
	if err != nil {
		res.Timing.Total = ms(time.Since(start))
		res.Err, res.Category = err, Categorize(err)
		return res
	}
	defer resp.Body.Close()
	res.Status, res.Header = resp.StatusCode, resp.Header
	var buf bytes.Buffer
	n, err := io.Copy(&buf, io.LimitReader(resp.Body, MaxReadBody))
	rest, err2 := io.Copy(io.Discard, resp.Body)
	end := time.Now()
	res.Body, res.BytesIn = buf.Bytes(), n+rest
	if err == nil {
		err = err2
	}
	res.Timing.Total = ms(end.Sub(start))
	if !firstByte.IsZero() {
		if !wrote.IsZero() {
			res.Timing.TTFB = ms(firstByte.Sub(wrote))
		}
		res.Timing.Download = ms(end.Sub(firstByte))
	}
	if err != nil {
		res.Err, res.Category = err, Categorize(err)
	}
	return res
}

// UserAgent is sent unless a step sets its own. main sets the version.
var UserAgent = "ndswarm"

// Categorize maps a transport error to the error categories shown in the UI.
func Categorize(err error) string {
	var dnsErr *net.DNSError
	var tErr TemplateError
	var certErr *tls.CertificateVerificationError
	var recErr tls.RecordHeaderError
	switch {
	case errors.As(err, &tErr):
		return "template"
	case errors.Is(err, ErrBlockedTarget), errors.Is(err, ErrNotAllowed):
		return "connection"
	case errors.Is(err, context.DeadlineExceeded), errors.Is(err, os.ErrDeadlineExceeded):
		return "timeout"
	case errors.As(err, &dnsErr):
		return "dns"
	case errors.As(err, &certErr), errors.As(err, &recErr), strings.Contains(err.Error(), "tls:"):
		return "tls"
	}
	var ne net.Error
	if errors.As(err, &ne) && ne.Timeout() {
		return "timeout"
	}
	return "connection"
}

func ms(d time.Duration) float64 { return float64(d.Microseconds()) / 1000 }
