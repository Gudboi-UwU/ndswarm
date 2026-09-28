package model

import (
	"fmt"
	"strings"
)

// MaxVUsLimit caps maxVUs for every test (NDSWARM_MAX_VUS).
var MaxVUsLimit = 5000

const (
	MaxStages         = 50
	MaxDurationSec    = 7 * 24 * 3600
	MaxGracefulStop   = 600
	defaultGraceful   = 30
	defaultStageVUs   = 5
	defaultStageSec   = 60
	maxUserAgentBytes = 500
)

// Load is the closed model: virtual users ramp linearly between stage targets (like k6).
type Load struct {
	Model           string  `json:"model"` // closed (open arrives later)
	Stages          []Stage `json:"stages"`
	GracefulStopSec int     `json:"gracefulStopSec"`
	MaxVUs          int     `json:"maxVUs"`
}

type Stage struct {
	DurationSec int `json:"durationSec"`
	Target      int `json:"target"`
}

// Settings are HTTP client options for a run.
type Settings struct {
	KeepAlive   bool   `json:"keepAlive"`
	HTTP2       bool   `json:"http2"`
	InsecureTLS bool   `json:"insecureTLS"`
	UserAgent   string `json:"userAgent"` // empty = ndswarm/<version>
}

// DefaultSettings is used for tests saved before settings existed.
var DefaultSettings = Settings{KeepAlive: true, HTTP2: true}

func (l *Load) normalize() {
	if l.Model == "" {
		l.Model = "closed"
	}
	if len(l.Stages) == 0 { // the Smoke preset: short ramp, then hold
		l.Stages = []Stage{{DurationSec: 5, Target: defaultStageVUs}, {DurationSec: defaultStageSec - 5, Target: defaultStageVUs}}
	}
	if l.GracefulStopSec == 0 {
		l.GracefulStopSec = defaultGraceful
	}
	if l.MaxVUs == 0 {
		l.MaxVUs = l.PeakTarget()
	}
}

// PeakTarget is the highest stage target.
func (l Load) PeakTarget() int {
	peak := 0
	for _, s := range l.Stages {
		peak = max(peak, s.Target)
	}
	return peak
}

// DurationSec is the scheduled length of all stages.
func (l Load) DurationSec() int {
	total := 0
	for _, s := range l.Stages {
		total += s.DurationSec
	}
	return total
}

// TargetAt returns the VU target at elapsed seconds, interpolating from the previous stage's target (0 at start).
func (l Load) TargetAt(elapsed float64) int {
	from, at := 0.0, 0.0
	for _, s := range l.Stages {
		end := at + float64(s.DurationSec)
		if elapsed < end {
			frac := (elapsed - at) / float64(s.DurationSec)
			return int(from + (float64(s.Target)-from)*frac + 0.5)
		}
		from, at = float64(s.Target), end
	}
	return int(from)
}

func (l Load) validate(v *ValidationError) {
	v.Check(l.Model == "closed", "load.model", "Only the closed model (virtual users) is available.")
	v.Check(len(l.Stages) >= 1 && len(l.Stages) <= MaxStages, "load.stages", fmt.Sprintf("Use 1-%d stages.", MaxStages))
	for i, s := range l.Stages {
		p := fmt.Sprintf("load.stages.%d", i)
		v.Check(s.DurationSec >= 1, p+".durationSec", "Use at least 1 second.")
		v.Check(s.Target >= 0 && s.Target <= l.MaxVUs, p+".target", "Use 0 up to max VUs.")
	}
	v.Check(l.PeakTarget() > 0, "load.stages", "At least one stage needs more than 0 virtual users.")
	v.Check(l.DurationSec() <= MaxDurationSec, "load.stages", "A run can last at most 7 days.")
	v.Check(l.MaxVUs >= 1 && l.MaxVUs <= MaxVUsLimit, "load.maxVUs", fmt.Sprintf("Use 1-%d (server limit NDSWARM_MAX_VUS).", MaxVUsLimit))
	v.Check(l.GracefulStopSec >= 0 && l.GracefulStopSec <= MaxGracefulStop, "load.gracefulStopSec", "Use 0-600 seconds.")
}

func (s Settings) validate(v *ValidationError) {
	v.Check(len(s.UserAgent) <= maxUserAgentBytes && !strings.ContainsAny(s.UserAgent, "\r\n"), "settings.userAgent", "Use one line of at most 500 characters.")
}
