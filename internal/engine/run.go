package engine

import (
	"context"
	"fmt"
	"math/rand/v2"
	"net/http"
	"sync"
	"sync/atomic"
	"time"

	"github.com/Gudboi-UwU/ndswarm/internal/logsink"
	"github.com/Gudboi-UwU/ndswarm/internal/metrics"
	"github.com/Gudboi-UwU/ndswarm/internal/model"
	"github.com/Gudboi-UwU/ndswarm/internal/tmpl"
)

// MaxKeys caps statistic keys (flow / step [variant]) per run.
const MaxKeys = 200

// Key names one statistic series. The UI shows "Flow / Step [variant]".
type Key struct {
	ID      int    `json:"keyId"`
	Flow    string `json:"flow"`
	Step    string `json:"step"`
	Variant string `json:"variant"`
	Method  string `json:"method"`
	URL     string `json:"url"`
}

// Plan is a test compiled for running: enabled flows, steps and variants only.
type Plan struct {
	Keys     []Key
	Load     model.Load
	Settings model.Settings
	Guard    Guard // set by the caller from server settings
	env      *model.Environment
	redact   Redactor
	flows    []planFlow
	weights  picker
}

type planFlow struct{ steps []*planStep }

type planStep struct {
	*Step
	keys     []int // per enabled variant, or one key when there is no body
	timeout  time.Duration
	follow   bool
	rr       atomic.Uint64
	variants picker
}

// picker chooses an index by weight.
type picker struct {
	cum   []int
	total int
}

func newPicker(weights []int) picker {
	p := picker{}
	for _, w := range weights {
		p.total += w
		p.cum = append(p.cum, p.total)
	}
	return p
}

func (p picker) pick(r *rand.Rand) int {
	if len(p.cum) == 1 || p.total == 0 {
		return 0
	}
	n := r.IntN(p.total)
	for i, c := range p.cum {
		if n < c {
			return i
		}
	}
	return len(p.cum) - 1
}

// NewPlan compiles t against env. It fails when nothing would run or there are too many keys.
func NewPlan(t model.Test, env *model.Environment) (*Plan, error) {
	p := &Plan{Load: t.Load, Settings: t.Settings, env: env, redact: NewRedactor(nil)}
	if env != nil {
		p.redact = NewRedactor(env.SecretValues())
	}
	var weights []int
	for _, f := range t.Flows {
		if !f.Enabled || f.Weight <= 0 {
			continue
		}
		pf := planFlow{}
		for _, s := range f.Steps {
			if !s.Enabled {
				continue
			}
			cs, err := Compile(s, env)
			if err != nil {
				return nil, fmt.Errorf("%s / %s: %w", f.Name, s.Name, err)
			}
			ps := &planStep{Step: cs, timeout: time.Duration(s.TimeoutMs) * time.Millisecond, follow: s.FollowRedirects}
			addKey := func(variant string) {
				ps.keys = append(ps.keys, len(p.Keys))
				p.Keys = append(p.Keys, Key{ID: len(p.Keys), Flow: f.Name, Step: s.Name, Variant: variant, Method: s.Method, URL: s.URL})
			}
			if len(cs.Variants) == 0 {
				if s.Body.Type != "none" {
					return nil, fmt.Errorf("%s / %s: every body variant is disabled", f.Name, s.Name)
				}
				addKey("")
			}
			var vw []int
			for _, v := range cs.Variants {
				addKey(v.Name)
				vw = append(vw, max(v.Weight, 0))
			}
			ps.variants = newPicker(vw)
			pf.steps = append(pf.steps, ps)
		}
		if len(pf.steps) > 0 {
			p.flows = append(p.flows, pf)
			weights = append(weights, f.Weight)
		}
	}
	if len(p.flows) == 0 {
		return nil, fmt.Errorf("no enabled endpoint with a weight above 0")
	}
	if len(p.Keys) > MaxKeys {
		return nil, fmt.Errorf("%d statistic series (endpoint x variant); the limit is %d", len(p.Keys), MaxKeys)
	}
	p.weights = newPicker(weights)
	return p, nil
}

// variant picks the body variant for one request.
func (s *planStep) variant(pick string, r *rand.Rand) int {
	n := len(s.Variants)
	if n <= 1 {
		return 0
	}
	switch pick {
	case "random":
		return r.IntN(n)
	case "weighted":
		return s.variants.pick(r)
	}
	return int(s.rr.Add(1)-1) % n
}

// Tick is reported once per second while a run is going.
type Tick struct {
	Elapsed float64
	VUs     int
	Target  int
	Snap    metrics.Snapshot
}

// Run executes p until the stages end or ctx is cancelled. onTick runs on the calling goroutine.
// On a normal end VUs finish their iteration (up to gracefulStopSec); on cancel they stop at once
// and interrupted requests are not counted.
// logs may be nil (no request logging).
func Run(ctx context.Context, p *Plan, rec *metrics.Recorder, logs *logsink.Sink, onTick func(Tick)) {
	transport := NewTransport(ClientOptions{MaxConnsPerHost: p.Load.MaxVUs, HTTP2: p.Settings.HTTP2, InsecureTLS: p.Settings.InsecureTLS, Guard: p.Guard})
	transport.DisableKeepAlives = !p.Settings.KeepAlive
	defer transport.CloseIdleConnections()

	vuCtx, stopVUs := context.WithCancel(ctx)
	defer stopVUs()
	r := &runner{
		plan:     p,
		rec:      rec,
		ctx:      vuCtx,
		follow:   Client(transport, true),
		noFollow: Client(transport, false),
		seq:      new(atomic.Int64),
		alive:    make([]atomic.Bool, p.Load.MaxVUs),
		ua:       p.Settings.UserAgent,
		logs:     logs,
		start:    time.Now(),
	}

	start := r.start
	elapsed := func() float64 { return time.Since(start).Seconds() }
	duration := float64(p.Load.DurationSec())
	sched := time.NewTicker(100 * time.Millisecond)
	defer sched.Stop()
	second := time.NewTicker(time.Second)
	defer second.Stop()
	tick := func() {
		e := elapsed()
		onTick(Tick{Elapsed: e, VUs: int(r.running.Load()), Target: int(r.target.Load()), Snap: rec.Tick(e)})
	}

	r.schedule(0)
loop:
	for {
		select {
		case <-ctx.Done():
			break loop
		case <-sched.C:
			if e := elapsed(); e >= duration {
				break loop
			} else {
				r.schedule(e)
			}
		case <-second.C:
			tick()
		}
	}

	// Ramp down: no new iterations; a normal end lets running iterations finish.
	r.target.Store(0)
	if ctx.Err() == nil {
		deadline := time.After(time.Duration(p.Load.GracefulStopSec) * time.Second)
	drain:
		for r.running.Load() > 0 {
			select {
			case <-deadline:
				break drain
			case <-ctx.Done():
				break drain
			case <-second.C:
				tick()
			case <-time.After(20 * time.Millisecond):
			}
		}
	}
	stopVUs()
	r.wg.Wait()
	tick() // the partial last second
}

type runner struct {
	plan             *Plan
	rec              *metrics.Recorder
	ctx              context.Context
	follow, noFollow *http.Client
	seq              *atomic.Int64
	ua               string
	logs             *logsink.Sink
	start            time.Time

	target  atomic.Int64
	running atomic.Int64
	alive   []atomic.Bool // alive[i]: VU i is running (ids are reused after a VU exits)
	wg      sync.WaitGroup
}

// schedule sets the VU target for elapsed seconds and starts missing VUs.
// VUs above the target exit on their own at the start of their next iteration.
func (r *runner) schedule(elapsed float64) {
	t := min(r.plan.Load.TargetAt(elapsed), r.plan.Load.MaxVUs)
	r.target.Store(int64(t))
	for id := range t {
		if r.alive[id].CompareAndSwap(false, true) {
			r.running.Add(1)
			r.wg.Add(1)
			go r.vu(id)
		}
	}
}

func (r *runner) vu(id int) {
	defer func() {
		r.alive[id].Store(false)
		r.running.Add(-1)
		r.wg.Done()
	}()
	c := tmpl.NewCtx(rand.Uint64(), nil, r.seq)
	c.VU = id + 1
	envErr := error(nil)
	if _, err := EnvVars(r.plan.env, c); err != nil {
		envErr = err // preflight catches this; if it slips through, every request is a template error
	}
	for iter := int64(1); ; iter++ {
		if r.ctx.Err() != nil || int64(id) >= r.target.Load() {
			return
		}
		c.Iter = iter
		flow := r.plan.flows[r.plan.weights.pick(c.Rand)]
		for _, st := range flow.steps {
			if !r.step(c, st, envErr) {
				return
			}
		}
	}
}

// step sends one request and records it. It returns false when the run is stopping.
func (r *runner) step(c *tmpl.Ctx, st *planStep, envErr error) bool {
	vi := st.variant(st.Pick, c.Rand)
	key := st.keys[min(vi, len(st.keys)-1)]
	if envErr == nil {
		req, err := st.Render(c, vi)
		if err == nil {
			return r.send(c, st, key, req)
		}
		envErr = err
	}
	// ponytail: a template that fails only at run time is retried every 10ms; preflight renders every variant first.
	r.rec.Record(key, metrics.Sample{Category: "template"})
	r.log(c, key, nil, Result{Err: envErr, Category: "template"})
	return sleep(r.ctx, 10*time.Millisecond)
}

func (r *runner) send(c *tmpl.Ctx, st *planStep, key int, req *Request) bool {
	if r.ua != "" && req.Header.Get("User-Agent") == "" {
		req.Header.Set("User-Agent", r.ua)
	}
	client := r.noFollow
	if st.follow {
		client = r.follow
	}
	res := Send(r.ctx, client, req, st.timeout)
	if r.ctx.Err() != nil {
		return false // stopped mid-request: not a real result
	}
	sample := ToSample(res)
	res.Category = sample.Category
	r.rec.Record(key, sample)
	r.log(c, key, req, res)
	return true
}

// log offers one finished request to the log sink; the entry is only built when it is kept.
func (r *runner) log(c *tmpl.Ctx, key int, req *Request, res Result) {
	if r.logs == nil {
		return
	}
	sec := int64(time.Since(r.start).Seconds()) + 1 // 1-based, like the per-second metrics (t=1 is the first second)
	msg := ""
	if res.Category != "" {
		msg = r.plan.redact.String(errorMessage(res)) // group messages are shown and stored too
		r.logs.CountError(key, res.Category, msg, sec)
	}
	reason := r.logs.Want(key, res.Category, res.Timing.Total, c.Rand)
	if reason == "" {
		return
	}
	r.logs.Add(r.plan.entry(c, key, sec, reason, msg, req, res))
}

// errorMessage is the text an error group is keyed on.
func errorMessage(res Result) string {
	if res.Err != nil {
		return res.Err.Error()
	}
	return fmt.Sprintf("HTTP %d %s", res.Status, http.StatusText(res.Status))
}

// ToSample converts a Result into a metrics sample with the OK/error definition:
// OK = no transport error and status 200-399.
func ToSample(res Result) metrics.Sample {
	s := metrics.Sample{
		LatencyUs: int64(res.Timing.Total * 1000),
		Status:    res.Status,
		Category:  res.Category,
		BytesIn:   res.BytesIn,
		BytesOut:  res.BytesOut,
		DNS:       res.Timing.DNS,
		Connect:   res.Timing.Connect,
		TLS:       res.Timing.TLS,
		TTFB:      res.Timing.TTFB,
		Download:  res.Timing.Download,
	}
	if s.Category == "" {
		switch {
		case res.Status >= 500:
			s.Category = "http_5xx"
		case res.Status >= 400:
			s.Category = "http_4xx"
		case res.Status < 200:
			s.Category = "connection"
		}
	}
	return s
}

func sleep(ctx context.Context, d time.Duration) bool {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-t.C:
		return true
	}
}
