// Command bench checks that one ndswarm instance sustains the target request rate.
//
// It creates a one-endpoint test through the API, runs it, and reads the steady-state
// requests per second from the per-second metrics. With -container it also samples the
// generator's CPU through `docker stats` and fails above -max-cpu percent of -cpus cores.
package main

import (
	"bytes"
	"encoding/json"
	"flag"
	"fmt"
	"net/http"
	"net/http/cookiejar"
	"os"
	"os/exec"
	"sort"
	"strconv"
	"strings"
	"time"
)

func main() {
	base := flag.String("url", "http://127.0.0.1:8089", "ndswarm base URL")
	target := flag.String("target", "http://dummytarget:8090", "base URL of the dummy target, as ndswarm sees it")
	user := flag.String("user", "admin", "admin username (created if the server is new)")
	pass := flag.String("pass", "benchmark-pw", "admin password")
	vus := flag.Int("vus", 100, "virtual users")
	secs := flag.Int("duration", 30, "seconds at full load")
	minRPS := flag.Float64("min-rps", 20000, "fail below this steady-state rate")
	container := flag.String("container", "", "docker container of ndswarm, to sample CPU")
	cpus := flag.Float64("cpus", 4, "CPU cores available to ndswarm")
	maxCPU := flag.Float64("max-cpu", 85, "fail if serving -min-rps needs more than this share of -cpus, in percent")
	flag.Parse()

	jar, _ := cookiejar.New(nil)
	c := &client{base: *base + "/api/v1", http: &http.Client{Jar: jar, Timeout: 30 * time.Second}}
	var me struct{ SetupRequired bool }
	c.must("GET", "/auth/me", nil, &me)
	creds := map[string]string{"username": *user, "password": *pass}
	if me.SetupRequired {
		c.must("POST", "/auth/setup", creds, nil)
	} else {
		c.must("POST", "/auth/login", creds, nil)
	}

	var p, e, t struct{ ID int64 }
	c.must("POST", "/projects", map[string]string{"name": "Benchmark " + time.Now().Format(time.DateTime)}, &p)
	c.must("POST", fmt.Sprintf("/projects/%d/environments", p.ID), map[string]string{"name": "target", "baseUrl": *target}, &e)
	c.must("POST", fmt.Sprintf("/projects/%d/tests", p.ID), map[string]any{
		"name": "GET /fast", "environmentId": e.ID,
		"flows": []any{map[string]any{"id": "fast", "name": "fast", "enabled": true, "weight": 1, "steps": []any{map[string]any{
			"id": "fast", "name": "fast", "enabled": true, "method": "GET", "url": "/fast", "timeoutMs": 5000, "followRedirects": true, "body": map[string]string{"type": "none"},
		}}}},
		"load": map[string]any{"stages": []any{map[string]int{"durationSec": 2, "target": *vus}, map[string]int{"durationSec": *secs, "target": *vus}}, "maxVUs": *vus, "gracefulStopSec": 5},
	}, &t)

	var run struct{ ID int64 }
	c.must("POST", fmt.Sprintf("/tests/%d/runs", t.ID), map[string]bool{"force": true}, &run)
	fmt.Printf("run #%d: %d VUs for %ds against %s/fast\n", run.ID, *vus, *secs, *target)

	var cpuSamples []float64
	for {
		time.Sleep(time.Second)
		var r struct {
			Status string
			Live   *struct{ ElapsedSec float64 }
		}
		c.must("GET", fmt.Sprintf("/runs/%d", run.ID), nil, &r)
		if r.Status != "running" && r.Status != "stopping" {
			break
		}
		if *container != "" && r.Live != nil && r.Live.ElapsedSec > 4 && r.Live.ElapsedSec < float64(*secs) {
			if v, err := dockerCPU(*container); err == nil {
				cpuSamples = append(cpuSamples, v)
			}
		}
	}

	var points []struct {
		T     int64
		Count int64
		Err   int64
		P99   float64
	}
	c.must("GET", fmt.Sprintf("/runs/%d/timeseries", run.ID), nil, &points)
	var steady []float64
	var errs, total int64
	var p99 []float64
	for _, pt := range points {
		if pt.T > 4 && pt.T <= int64(*secs) { // skip the ramp and the partial last second
			steady = append(steady, float64(pt.Count))
			p99 = append(p99, pt.P99)
			errs += pt.Err
			total += pt.Count
		}
	}
	if len(steady) == 0 {
		fail("no steady-state seconds recorded")
	}
	rps := median(steady)
	fmt.Printf("steady state: median %.0f req/s (min %.0f, max %.0f) over %d s, errors %d of %d, median p99 %.2f ms\n",
		rps, minOf(steady), maxOf(steady), len(steady), errs, total, median(p99))

	ok := true
	if rps < *minRPS {
		fmt.Printf("FAIL: %.0f req/s is below %.0f\n", rps, *minRPS)
		ok = false
	}
	if errs > 0 {
		fmt.Printf("FAIL: %d errors against the dummy target\n", errs)
		ok = false
	}
	if len(cpuSamples) > 0 {
		// A closed model runs as fast as it can, so CPU is near its limit at any rate.
		// The question is headroom: how much of the budget does the target rate need?
		cpu := median(cpuSamples)
		share := cpu / (*cpus * 100) * 100
		needed := share * *minRPS / rps
		fmt.Printf("generator CPU: %.0f%% of %.0f cores at %.0f req/s, so %.0f req/s needs about %.0f%%\n", share, *cpus, rps, *minRPS, needed)
		if needed > *maxCPU {
			fmt.Printf("FAIL: %.0f req/s needs %.0f%% CPU, above %.0f%%\n", *minRPS, needed, *maxCPU)
			ok = false
		}
	}
	if !ok {
		os.Exit(1)
	}
	fmt.Println("PASS")
}

type client struct {
	base string
	http *http.Client
}

func (c *client) must(method, path string, body, out any) {
	var r *bytes.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		r = bytes.NewReader(b)
	} else {
		r = bytes.NewReader(nil)
	}
	req, _ := http.NewRequest(method, c.base+path, r)
	req.Header.Set("X-Requested-With", "ndswarm")
	req.Header.Set("Content-Type", "application/json")
	res, err := c.http.Do(req)
	if err != nil {
		fail(err.Error())
	}
	defer res.Body.Close()
	if res.StatusCode >= 300 {
		var e bytes.Buffer
		e.ReadFrom(res.Body)
		fail(fmt.Sprintf("%s %s: %s %s", method, path, res.Status, e.String()))
	}
	if out != nil {
		json.NewDecoder(res.Body).Decode(out)
	}
}

// dockerCPU returns the container's CPU in percent of one core.
func dockerCPU(name string) (float64, error) {
	out, err := exec.Command("docker", "stats", "--no-stream", "--format", "{{.CPUPerc}}", name).Output()
	if err != nil {
		return 0, err
	}
	return strconv.ParseFloat(strings.TrimSuffix(strings.TrimSpace(string(out)), "%"), 64)
}

func median(v []float64) float64 {
	s := append([]float64(nil), v...)
	sort.Float64s(s)
	return s[len(s)/2]
}

func minOf(v []float64) float64 {
	m := v[0]
	for _, x := range v {
		m = min(m, x)
	}
	return m
}

func maxOf(v []float64) float64 {
	m := v[0]
	for _, x := range v {
		m = max(m, x)
	}
	return m
}

func fail(msg string) {
	fmt.Fprintln(os.Stderr, "bench:", msg)
	os.Exit(1)
}
