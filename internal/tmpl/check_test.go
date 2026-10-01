package tmpl

import (
	"reflect"
	"testing"
)

func TestTemplateVars(t *testing.T) {
	cases := []struct {
		src  string
		want []string
	}{
		{`plain text`, nil},
		{`{{var "token"}}`, []string{"token"}},
		{`{{var "a"}}-{{var "b"}}-{{var "a"}}`, []string{"a", "b"}}, // de-duplicated, first-use order
		{`{{if var "flag"}}on{{else}}off{{end}}`, []string{"flag"}},
		{`{{range var "list"}}{{.}}{{end}}`, []string{"list"}},
		{`{{with var "x"}}{{.}}{{end}}`, []string{"x"}},
		{`{{int "min" (var "lo")}}`, []string{"lo"}}, // nested pipeline argument
		{`{{uuid}}`, nil},
	}
	for _, c := range cases {
		tmpl, err := Compile(c.src)
		if err != nil {
			t.Fatalf("Compile(%q): %v", c.src, err)
		}
		got := tmpl.Vars()
		if !reflect.DeepEqual(got, c.want) {
			t.Errorf("Vars(%q) = %v, want %v", c.src, got, c.want)
		}
	}
}

func TestTemplateVarsLiteral(t *testing.T) {
	tmpl, err := Compile("no braces here")
	if err != nil {
		t.Fatal(err)
	}
	if got := tmpl.Vars(); got != nil {
		t.Errorf("literal template Vars() = %v, want nil", got)
	}
}
