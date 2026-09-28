package tmpl

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"math"
	"net/url"
	"strconv"
	"strings"
	"text/template"
	"time"
)

// Param describes one positional argument, in call order.
type Param struct {
	Name    string `json:"name"`
	Type    string `json:"type"` // int | float | string | strings
	Default any    `json:"default,omitempty"`
}

// Generator is one template function. The UI lists the catalog in its picker.
type Generator struct {
	ID      string  `json:"id"`
	Label   string  `json:"label"`
	Group   string  `json:"group"`
	Output  string  `json:"output"` // string | integer | number | boolean
	Params  []Param `json:"params"`
	Snippet string  `json:"snippet"` // what the picker inserts
	fn      func(c *Ctx, a args) (string, error)
}

var Catalog = []Generator{
	{ID: "uuid", Label: "UUID v4", Group: "Identity", Output: "string", fn: func(c *Ctx, _ args) (string, error) { return c.Fake.UUID(), nil }},
	{ID: "string", Label: "Random string", Group: "Basic", Output: "string",
		Params: []Param{{"min", "int", 8}, {"max", "int", 16}},
		fn: func(c *Ctx, a args) (string, error) {
			n, err := between(c, a.int(0), a.int(1))
			if err != nil {
				return "", err
			}
			if n > 10000 {
				return "", fmt.Errorf("string: max length is 10000")
			}
			const alnum = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
			b := make([]byte, n)
			for i := range b {
				b[i] = alnum[c.Rand.IntN(len(alnum))]
			}
			return string(b), a.err
		}},
	{ID: "int", Label: "Integer", Group: "Basic", Output: "integer",
		Params: []Param{{"min", "int", 1}, {"max", "int", 100}},
		fn: func(c *Ctx, a args) (string, error) {
			n, err := between(c, a.int(0), a.int(1))
			return strconv.FormatInt(n, 10), errOr(a.err, err)
		}},
	{ID: "float", Label: "Decimal number", Group: "Basic", Output: "number",
		Params: []Param{{"min", "float", 0}, {"max", "float", 100}, {"decimals", "int", 2}},
		fn: func(c *Ctx, a args) (string, error) {
			lo, hi, dec := a.float(0), a.float(1), a.int(2)
			if a.err != nil {
				return "", a.err
			}
			if hi < lo || dec < 0 || dec > 10 {
				return "", fmt.Errorf("float: need min <= max and 0-10 decimals")
			}
			v := lo + c.Rand.Float64()*(hi-lo)
			return strconv.FormatFloat(v, 'f', int(dec), 64), nil
		}},
	{ID: "bool", Label: "Boolean", Group: "Basic", Output: "boolean",
		Params: []Param{{"probability", "float", 0.5}},
		fn: func(c *Ctx, a args) (string, error) {
			return strconv.FormatBool(c.Rand.Float64() < a.float(0)), a.err
		}},
	{ID: "pick", Label: "Pick one of", Group: "Basic", Output: "string",
		Params:  []Param{{"values", "strings", nil}},
		Snippet: `{{pick "a" "b" "c"}}`,
		fn: func(c *Ctx, a args) (string, error) {
			if len(a.v) == 0 {
				return "", fmt.Errorf("pick: give at least one value")
			}
			return a.str(c.Rand.IntN(len(a.v))), a.err
		}},
	{ID: "email", Label: "Email", Group: "Person", Output: "string", fn: func(c *Ctx, _ args) (string, error) { return c.Fake.Email(), nil }},
	{ID: "username", Label: "Username", Group: "Person", Output: "string", fn: func(c *Ctx, _ args) (string, error) { return c.Fake.Username(), nil }},
	{ID: "password", Label: "Password", Group: "Person", Output: "string",
		fn: func(c *Ctx, _ args) (string, error) { return c.Fake.Password(true, true, true, false, false, 12), nil }},
	{ID: "firstName", Label: "First name", Group: "Person", Output: "string", fn: func(c *Ctx, _ args) (string, error) { return c.Fake.FirstName(), nil }},
	{ID: "lastName", Label: "Last name", Group: "Person", Output: "string", fn: func(c *Ctx, _ args) (string, error) { return c.Fake.LastName(), nil }},
	{ID: "name", Label: "Full name", Group: "Person", Output: "string", fn: func(c *Ctx, _ args) (string, error) { return c.Fake.Name(), nil }},
	{ID: "phone", Label: "Phone number", Group: "Person", Output: "string",
		Params: []Param{{"format", "string", "+62 8##-####-####"}},
		fn: func(c *Ctx, a args) (string, error) {
			b := []byte(a.str(0)) // each # becomes a digit; everything else is kept
			for i := range b {
				if b[i] == '#' {
					b[i] = '0' + byte(c.Rand.IntN(10))
				}
			}
			return string(b), a.err
		}},
	{ID: "address", Label: "Street address", Group: "Place", Output: "string", fn: func(c *Ctx, _ args) (string, error) { return c.Fake.Street(), nil }},
	{ID: "city", Label: "City", Group: "Place", Output: "string", fn: func(c *Ctx, _ args) (string, error) { return c.Fake.City(), nil }},
	{ID: "country", Label: "Country", Group: "Place", Output: "string", fn: func(c *Ctx, _ args) (string, error) { return c.Fake.Country(), nil }},
	{ID: "company", Label: "Company", Group: "Place", Output: "string", fn: func(c *Ctx, _ args) (string, error) { return c.Fake.Company(), nil }},
	{ID: "jobTitle", Label: "Job title", Group: "Place", Output: "string", fn: func(c *Ctx, _ args) (string, error) { return c.Fake.JobTitle(), nil }},
	{ID: "sentence", Label: "Sentence", Group: "Text", Output: "string",
		Params: []Param{{"words", "int", 6}},
		fn: func(c *Ctx, a args) (string, error) {
			n := a.int(0)
			if n < 1 || n > 1000 {
				return "", fmt.Errorf("sentence: words must be 1-1000")
			}
			return c.Fake.LoremIpsumSentence(int(n)), a.err
		}},
	{ID: "paragraph", Label: "Paragraphs", Group: "Text", Output: "string",
		Params: []Param{{"count", "int", 1}},
		fn: func(c *Ctx, a args) (string, error) {
			n := a.int(0)
			if n < 1 || n > 100 {
				return "", fmt.Errorf("paragraph: count must be 1-100")
			}
			return c.Fake.LoremIpsumParagraph(int(n), 4, 10, "\n\n"), a.err
		}},
	{ID: "url", Label: "URL", Group: "Internet", Output: "string", fn: func(c *Ctx, _ args) (string, error) { return c.Fake.URL(), nil }},
	{ID: "ipv4", Label: "IPv4 address", Group: "Internet", Output: "string", fn: func(c *Ctx, _ args) (string, error) { return c.Fake.IPv4Address(), nil }},
	{ID: "hex", Label: "Hex string", Group: "Internet", Output: "string",
		Params: []Param{{"length", "int", 16}},
		fn: func(c *Ctx, a args) (string, error) {
			n := a.int(0)
			if n < 1 || n > 10000 {
				return "", fmt.Errorf("hex: length must be 1-10000")
			}
			const digits = "0123456789abcdef"
			b := make([]byte, n)
			for i := range b {
				b[i] = digits[c.Rand.IntN(16)]
			}
			return string(b), a.err
		}},
	{ID: "regex", Label: "Match a pattern", Group: "Internet", Output: "string",
		Params: []Param{{"pattern", "string", "[A-Z]{3}-[0-9]{4}"}},
		fn:     func(c *Ctx, a args) (string, error) { return c.Fake.Regex(a.str(0)), a.err }},
	{ID: "date", Label: "Random date", Group: "Time", Output: "string",
		Params: []Param{{"from", "string", "2024-01-01"}, {"to", "string", "2025-12-31"}, {"format", "string", "YYYY-MM-DD"}},
		fn: func(c *Ctx, a args) (string, error) {
			from, err1 := time.Parse(time.DateOnly, a.str(0))
			to, err2 := time.Parse(time.DateOnly, a.str(1))
			if err1 != nil || err2 != nil || to.Before(from) {
				return "", fmt.Errorf("date: from and to must be YYYY-MM-DD with from <= to")
			}
			span := to.Add(24*time.Hour).Unix() - from.Unix()
			return from.Add(time.Duration(c.Rand.Int64N(span)) * time.Second).Format(Layout(a.str(2))), a.err
		}},
	{ID: "now", Label: "Current time", Group: "Time", Output: "string",
		Params: []Param{{"format", "string", "YYYY-MM-DDTHH:mm:ssZ"}},
		fn:     func(_ *Ctx, a args) (string, error) { return time.Now().UTC().Format(Layout(a.str(0))), a.err }},
	{ID: "timestamp", Label: "Unix seconds", Group: "Time", Output: "integer",
		fn: func(*Ctx, args) (string, error) { return strconv.FormatInt(time.Now().Unix(), 10), nil }},
	{ID: "timestampMs", Label: "Unix milliseconds", Group: "Time", Output: "integer",
		fn: func(*Ctx, args) (string, error) { return strconv.FormatInt(time.Now().UnixMilli(), 10), nil }},
	{ID: "seq", Label: "Counter (whole run)", Group: "Run", Output: "integer",
		Params: []Param{{"start", "int", 1}, {"step", "int", 1}},
		fn: func(c *Ctx, a args) (string, error) {
			n := c.Seq.Add(1) - 1
			return strconv.FormatInt(a.int(0)+n*a.int(1), 10), a.err
		}},
	{ID: "vu", Label: "Virtual user number", Group: "Run", Output: "integer",
		fn: func(c *Ctx, _ args) (string, error) { return strconv.Itoa(c.VU), nil }},
	{ID: "iter", Label: "Iteration of this VU", Group: "Run", Output: "integer",
		fn: func(c *Ctx, _ args) (string, error) { return strconv.FormatInt(c.Iter, 10), nil }},
	{ID: "var", Label: "Variable", Group: "Run", Output: "string",
		Params:  []Param{{"name", "string", nil}},
		Snippet: `{{var "name"}}`,
		fn: func(c *Ctx, a args) (string, error) {
			name := a.str(0)
			v, ok := c.Vars[name]
			if !ok {
				return "", fmt.Errorf("var: %q is not set in this environment", name)
			}
			return v, a.err
		}},
	{ID: "q", Label: "JSON-quote", Group: "Helpers", Output: "string",
		Params:  []Param{{"value", "string", nil}},
		Snippet: `{{q (name)}}`,
		fn: func(_ *Ctx, a args) (string, error) {
			b, _ := json.Marshal(a.str(0))
			return string(b), a.err
		}},
	{ID: "base64", Label: "Base64 encode", Group: "Helpers", Output: "string",
		Params: []Param{{"value", "string", nil}}, Snippet: `{{base64 "user:pass"}}`,
		fn: func(_ *Ctx, a args) (string, error) {
			return base64.StdEncoding.EncodeToString([]byte(a.str(0))), a.err
		}},
	{ID: "urlencode", Label: "URL encode", Group: "Helpers", Output: "string",
		Params: []Param{{"value", "string", nil}}, Snippet: `{{urlencode (name)}}`,
		fn: func(_ *Ctx, a args) (string, error) { return url.QueryEscape(a.str(0)), a.err }},
	{ID: "lower", Label: "Lowercase", Group: "Helpers", Output: "string",
		Params: []Param{{"value", "string", nil}}, Snippet: `{{lower (name)}}`,
		fn: func(_ *Ctx, a args) (string, error) { return strings.ToLower(a.str(0)), a.err }},
	{ID: "upper", Label: "Uppercase", Group: "Helpers", Output: "string",
		Params: []Param{{"value", "string", nil}}, Snippet: `{{upper (name)}}`,
		fn: func(_ *Ctx, a args) (string, error) { return strings.ToUpper(a.str(0)), a.err }},
}

func init() {
	for i := range Catalog {
		g := &Catalog[i]
		if g.Snippet == "" {
			g.Snippet = snippet(g)
		}
	}
}

func snippet(g *Generator) string {
	var b strings.Builder
	b.WriteString("{{" + g.ID)
	for _, p := range g.Params {
		if s, ok := p.Default.(string); ok {
			b.WriteString(" " + strconv.Quote(s))
		} else if p.Default != nil {
			b.WriteString(fmt.Sprint(" ", p.Default))
		}
	}
	return b.String() + "}}"
}

// funcsFor binds every catalog entry to c. With c == nil the funcs exist only for parsing.
func funcsFor(c *Ctx) template.FuncMap {
	m := template.FuncMap{}
	for i := range Catalog {
		g := &Catalog[i]
		m[g.ID] = func(v ...any) (string, error) {
			if c == nil {
				return "", fmt.Errorf("template not bound")
			}
			a := args{v: v, params: g.Params, id: g.ID}
			return g.fn(c, a)
		}
	}
	return m
}

// Generate calls one generator with positional args, as the Fields editor preview does.
func Generate(c *Ctx, id string, v ...any) (string, error) {
	for i := range Catalog {
		if Catalog[i].ID == id {
			return Catalog[i].fn(c, args{v: v, params: Catalog[i].Params, id: id})
		}
	}
	return "", fmt.Errorf("unknown generator %q", id)
}

// args coerces template literals (int, float64, string) to what a generator needs,
// falling back to the param default. The first coercion problem is kept in err.
type args struct {
	v      []any
	params []Param
	id     string
	err    error
}

func (a *args) get(i int) any {
	if i < len(a.v) {
		return a.v[i]
	}
	if i < len(a.params) && a.params[i].Default != nil {
		return a.params[i].Default
	}
	if a.err == nil {
		name := fmt.Sprint("argument ", i+1)
		if i < len(a.params) {
			name = a.params[i].Name
		}
		a.err = fmt.Errorf("%s: missing %s", a.id, name)
	}
	return nil
}

func (a *args) int(i int) int64 {
	switch v := a.get(i).(type) {
	case int:
		return int64(v)
	case int64:
		return v
	case float64:
		if v == math.Trunc(v) {
			return int64(v)
		}
	case string:
		if n, err := strconv.ParseInt(strings.TrimSpace(v), 10, 64); err == nil {
			return n
		}
	case nil:
		return 0
	}
	a.fail(i, "a whole number")
	return 0
}

func (a *args) float(i int) float64 {
	switch v := a.get(i).(type) {
	case int:
		return float64(v)
	case int64:
		return float64(v)
	case float64:
		return v
	case string:
		if f, err := strconv.ParseFloat(strings.TrimSpace(v), 64); err == nil {
			return f
		}
	case nil:
		return 0
	}
	a.fail(i, "a number")
	return 0
}

func (a *args) str(i int) string {
	v := a.get(i)
	if v == nil {
		return ""
	}
	return fmt.Sprint(v)
}

func (a *args) fail(i int, want string) {
	if a.err == nil {
		name := fmt.Sprint("argument ", i+1)
		if i < len(a.params) {
			name = a.params[i].Name
		}
		a.err = fmt.Errorf("%s: %s must be %s", a.id, name, want)
	}
}

func between(c *Ctx, lo, hi int64) (int64, error) {
	if hi < lo {
		return 0, fmt.Errorf("min must be <= max")
	}
	return lo + c.Rand.Int64N(hi-lo+1), nil
}

func errOr(a, b error) error {
	if a != nil {
		return a
	}
	return b
}

var layoutReplacer = strings.NewReplacer(
	"YYYY", "2006", "YY", "06", "MM", "01", "DD", "02",
	"HH", "15", "mm", "04", "ss", "05", "SSS", "000", "Z", "Z07:00",
)

// Layout converts a friendly format (YYYY-MM-DD HH:mm:ss.SSS Z) to a Go time layout.
func Layout(friendly string) string { return layoutReplacer.Replace(friendly) }
