package tmpl

import (
	"regexp"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// TestCatalog runs every generator many times and checks its declared output type,
// plus the parameters that must be honored.
func TestCatalog(t *testing.T) {
	c := NewCtx(1, map[string]string{"name": "vera"}, nil)
	for _, g := range Catalog {
		tpl, err := Compile(g.Snippet)
		if err != nil {
			t.Errorf("%s: snippet %q does not compile: %v", g.ID, g.Snippet, err)
			continue
		}
		c.Vars["name"] = "vera"
		for range 50 {
			out, err := tpl.Execute(c)
			if err != nil {
				t.Errorf("%s: %v", g.ID, err)
				break
			}
			ok := true
			switch g.Output {
			case "integer":
				_, e := strconv.ParseInt(out, 10, 64)
				ok = e == nil
			case "number":
				_, e := strconv.ParseFloat(out, 64)
				ok = e == nil
			case "boolean":
				ok = out == "true" || out == "false"
			}
			if !ok {
				t.Errorf("%s: output %q is not %s", g.ID, out, g.Output)
				break
			}
		}
	}
}

func TestParamsHonored(t *testing.T) {
	c := NewCtx(7, map[string]string{"token": "abc"}, nil)
	each := func(src string, check func(string) bool) {
		t.Helper()
		tpl, err := Compile(src)
		if err != nil {
			t.Fatalf("%s: %v", src, err)
		}
		for range 300 {
			out, err := tpl.Execute(c)
			if err != nil || !check(out) {
				t.Fatalf("%s: got %q, %v", src, out, err)
			}
		}
	}
	each(`{{int 5 7}}`, func(s string) bool { n, _ := strconv.Atoi(s); return n >= 5 && n <= 7 })
	each(`{{int -3 -3}}`, func(s string) bool { return s == "-3" })
	each(`{{float 1 2 3}}`, func(s string) bool {
		f, _ := strconv.ParseFloat(s, 64)
		return f >= 1 && f <= 2 && len(s[strings.Index(s, ".")+1:]) == 3
	})
	each(`{{string 4 6}}`, func(s string) bool { return len(s) >= 4 && len(s) <= 6 })
	each(`{{hex 10}}`, regexp.MustCompile(`^[0-9a-f]{10}$`).MatchString)
	each(`{{bool 1}}`, func(s string) bool { return s == "true" })
	each(`{{bool 0}}`, func(s string) bool { return s == "false" })
	each(`{{pick "x" "y"}}`, func(s string) bool { return s == "x" || s == "y" })
	each(`{{phone "08##"}}`, regexp.MustCompile(`^08\d\d$`).MatchString)
	each(`{{regex "[A-Z]{3}-[0-9]{2}"}}`, regexp.MustCompile(`^[A-Z]{3}-[0-9]{2}$`).MatchString)
	each(`{{sentence 3}}`, func(s string) bool { return len(strings.Fields(s)) == 3 })
	each(`{{date "2024-02-01" "2024-02-03" "DD/MM/YYYY"}}`, func(s string) bool {
		return s == "01/02/2024" || s == "02/02/2024" || s == "03/02/2024"
	})
	each(`{{now "YYYY"}}`, func(s string) bool { return s == strconv.Itoa(time.Now().UTC().Year()) })
	each(`{{var "token"}}`, func(s string) bool { return s == "abc" })
	each(`{{q "a\"b"}}`, func(s string) bool { return s == `"a\"b"` })
	each(`{{upper (lower "AbC")}}`, func(s string) bool { return s == "ABC" })
	each(`{{base64 "user:pass"}}`, func(s string) bool { return s == "dXNlcjpwYXNz" })
	each(`{{urlencode "a b&c"}}`, func(s string) bool { return s == "a+b%26c" })

	// seq is shared across contexts of one run and honors start/step.
	seq := new(atomic.Int64)
	a, b := NewCtx(1, nil, seq), NewCtx(2, nil, seq)
	tpl, _ := Compile(`{{seq 10 5}}`)
	got := []string{}
	for _, cx := range []*Ctx{a, b, a} {
		s, _ := tpl.Execute(cx)
		got = append(got, s)
	}
	if strings.Join(got, ",") != "10,15,20" {
		t.Errorf("seq: %v", got)
	}
}

func TestErrors(t *testing.T) {
	c := NewCtx(1, nil, nil)
	if _, err := Compile(`{{nope}}`); err == nil || !strings.Contains(err.Error(), "nope") {
		t.Errorf("unknown function: %v", err)
	}
	if _, err := Compile(`{{int 1`); err == nil {
		t.Error("unclosed action accepted")
	}
	for src, want := range map[string]string{
		`{{int 9 1}}`:          "min must be <= max",
		`{{int "x" 3}}`:        "min must be a whole number",
		`{{var "missing"}}`:    `"missing" is not set`,
		`{{date "x" "y" "Z"}}`: "YYYY-MM-DD",
		`{{pick}}`:             "at least one value",
	} {
		tpl, err := Compile(src)
		if err != nil {
			t.Fatalf("%s: %v", src, err)
		}
		if _, err := tpl.Execute(c); err == nil || !strings.Contains(err.Error(), want) {
			t.Errorf("%s: got %v, want %q", src, err, want)
		}
	}
	if tpl, _ := Compile("plain {text}"); !tpl.IsLiteral() {
		t.Error("literal not detected")
	}
	if Layout("YYYY-MM-DDTHH:mm:ss.SSSZ") != "2006-01-02T15:04:05.000Z07:00" {
		t.Errorf("layout: %s", Layout("YYYY-MM-DDTHH:mm:ss.SSSZ"))
	}
}
