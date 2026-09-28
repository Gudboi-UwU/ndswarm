// Package tmpl renders request values: text/template plus a catalog of data generators.
//
// Every value in a test (URL, query, header, body field, raw body) is a template string.
// Plain text without "{{" is a literal and never touches text/template.
package tmpl

import (
	"fmt"
	"math/rand/v2"
	"strings"
	"sync/atomic"
	"text/template"

	"github.com/brianvoe/gofakeit/v7"
)

// MaxSize is the largest template source accepted.
const MaxSize = 1 << 20

// Ctx is the per-VU render state. It is not safe for concurrent use: each VU owns one.
type Ctx struct {
	Rand *rand.Rand
	Fake *gofakeit.Faker
	VU   int
	Iter int64
	Vars map[string]string // environment variables, later also extracted values
	Seq  *atomic.Int64     // shared by all VUs of a run

	bound map[*Template]*template.Template
}

func NewCtx(seed uint64, vars map[string]string, seq *atomic.Int64) *Ctx {
	src := rand.NewPCG(seed, seed^0x9e3779b97f4a7c15)
	if vars == nil {
		vars = map[string]string{}
	}
	if seq == nil {
		seq = new(atomic.Int64)
	}
	return &Ctx{
		Rand:  rand.New(src),
		Fake:  gofakeit.NewFaker(src, false),
		Vars:  vars,
		Seq:   seq,
		bound: map[*Template]*template.Template{},
	}
}

// Template is a compiled value. Compile once (at run start), execute per request.
type Template struct {
	src string
	t   *template.Template // nil for literals
}

// parseFuncs has every function name so Parse can resolve calls; Execute rebinds them per Ctx.
var parseFuncs = funcsFor(nil)

func Compile(src string) (*Template, error) {
	if len(src) > MaxSize {
		return nil, fmt.Errorf("template is larger than %d bytes", MaxSize)
	}
	if !strings.Contains(src, "{{") {
		return &Template{src: src}, nil
	}
	t, err := template.New("").Option("missingkey=error").Funcs(parseFuncs).Parse(src)
	if err != nil {
		return nil, cleanErr(err)
	}
	return &Template{src: src, t: t}, nil
}

func (t *Template) IsLiteral() bool { return t.t == nil }

func (t *Template) Execute(c *Ctx) (string, error) {
	if t.t == nil {
		return t.src, nil
	}
	bound := c.bound[t]
	if bound == nil {
		clone, err := t.t.Clone()
		if err != nil {
			return "", err
		}
		bound = clone.Funcs(funcsFor(c))
		c.bound[t] = bound
	}
	var b strings.Builder
	if err := bound.Execute(&b, nil); err != nil {
		return "", cleanErr(err)
	}
	return b.String(), nil
}

// cleanErr strips text/template's `template: :1:5: executing "" at <int>:` prefix noise.
func cleanErr(err error) error {
	msg := err.Error()
	msg = strings.TrimPrefix(msg, "template: ")
	if i := strings.Index(msg, "error calling "); i >= 0 {
		msg = msg[i+len("error calling "):]
	}
	return fmt.Errorf("%s", msg)
}
