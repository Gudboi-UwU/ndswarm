package engine

import (
	"context"
	"encoding/json"
	"fmt"
	"math/rand/v2"
	"sync"
	"time"

	"github.com/Gudboi-UwU/ndswarm/internal/tmpl"
)

// Check is the result of the single request preflight sends per step.
type Check struct {
	Name      string  `json:"name"` // "Flow / Step"
	Method    string  `json:"method"`
	URL       string  `json:"url"`
	Status    int     `json:"status"`
	LatencyMs float64 `json:"latencyMs"`
	Error     string  `json:"error,omitempty"`
	Snippet   string  `json:"snippet,omitempty"`
}

// RenderCheck renders every enabled variant `rounds` times, as VUs would, and checks raw JSON bodies.
// It returns one message per failing step or variant.
func (p *Plan) RenderCheck(rounds int) []string {
	var problems []string
	c := tmpl.NewCtx(rand.Uint64(), nil, nil)
	if _, err := EnvVars(p.env, c); err != nil {
		return []string{"Environment " + err.Error()}
	}
	for _, f := range p.flows {
		for _, st := range f.steps {
			n := max(len(st.Variants), 1)
			for vi := range n {
				name := p.Keys[st.keys[vi]].label()
				for range rounds {
					req, err := st.Render(c, vi)
					if err != nil {
						problems = append(problems, fmt.Sprintf("%s: %v", name, err))
						break
					}
					if st.bodyType == "json" && vi < len(st.Variants) && st.Variants[vi].raw != nil {
						var v any
						if err := json.Unmarshal(req.Body, &v); err != nil {
							problems = append(problems, fmt.Sprintf("%s: the raw body is not valid JSON (%v). Wrap text values in {{q ...}}.", name, err))
							break
						}
					}
				}
			}
		}
	}
	return problems
}

// SendCheck sends one request per enabled step (first variant), up to 8 at a time.
func (p *Plan) SendCheck(ctx context.Context) []Check {
	transport := NewTransport(ClientOptions{HTTP2: p.Settings.HTTP2, InsecureTLS: p.Settings.InsecureTLS, Guard: p.Guard})
	defer transport.CloseIdleConnections()

	type job struct {
		st   *planStep
		name string
	}
	var jobs []job
	for _, f := range p.flows {
		for _, st := range f.steps {
			jobs = append(jobs, job{st, p.Keys[st.keys[0]].label()})
		}
	}
	checks := make([]Check, len(jobs))
	sem := make(chan struct{}, 8)
	var wg sync.WaitGroup
	for i, j := range jobs {
		wg.Go(func() {
			sem <- struct{}{}
			defer func() { <-sem }()
			c := tmpl.NewCtx(rand.Uint64(), nil, nil)
			EnvVars(p.env, c)
			ck := Check{Name: j.name, Method: j.st.method}
			req, err := j.st.Render(c, 0)
			if err != nil {
				ck.Error = err.Error()
				checks[i] = ck
				return
			}
			if p.Settings.UserAgent != "" && req.Header.Get("User-Agent") == "" {
				req.Header.Set("User-Agent", p.Settings.UserAgent)
			}
			ck.URL = req.URL
			res := Send(ctx, Client(transport, j.st.follow), req, min(j.st.timeout, 10*time.Second))
			ck.Status, ck.LatencyMs = res.Status, res.Timing.Total
			if res.Err != nil {
				ck.Error = res.Err.Error()
			} else if cat := ToSample(res).Category; cat != "" {
				ck.Error = fmt.Sprintf("HTTP %d counts as an error (%s)", res.Status, cat)
			}
			ck.Snippet = string(res.Body[:min(len(res.Body), 300)])
			checks[i] = ck
		})
	}
	wg.Wait()
	return checks
}

func (k Key) label() string {
	s := k.Flow
	if k.Step != k.Flow {
		s += " / " + k.Step
	}
	if k.Variant != "" {
		s += " [" + k.Variant + "]"
	}
	return s
}
