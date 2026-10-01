package tmpl

import "text/template/parse"

// Vars returns the variable names a compiled template reads via {{var "name"}}, in first-use
// order with duplicates removed. A literal template (t.t == nil) has none.
//
// This only recognizes a string literal as the name, e.g. {{var "x"}} or {{if var "x"}}: a
// computed name such as {{var (print "x")}} is not tracked. That is the realistic use of `var`
// in a request template, so the gap is not worth the extra walking code.
func (t *Template) Vars() []string {
	if t.t == nil || t.t.Tree == nil {
		return nil
	}
	var names []string
	seen := map[string]bool{}
	walkNodes(t.t.Root, func(cmd *parse.CommandNode) {
		if len(cmd.Args) < 2 {
			return
		}
		id, ok := cmd.Args[0].(*parse.IdentifierNode)
		if !ok || id.Ident != "var" {
			return
		}
		s, ok := cmd.Args[1].(*parse.StringNode)
		if !ok || seen[s.Text] {
			return
		}
		seen[s.Text] = true
		names = append(names, s.Text)
	})
	return names
}

// walkNodes visits every CommandNode reachable from n, including inside if/range/with bodies
// and parenthesized sub-pipelines.
func walkNodes(n parse.Node, visit func(*parse.CommandNode)) {
	switch x := n.(type) {
	case nil:
	case *parse.ListNode:
		if x == nil {
			return
		}
		for _, c := range x.Nodes {
			walkNodes(c, visit)
		}
	case *parse.ActionNode:
		walkNodes(x.Pipe, visit)
	case *parse.IfNode:
		walkBranch(x.Pipe, x.List, x.ElseList, visit)
	case *parse.RangeNode:
		walkBranch(x.Pipe, x.List, x.ElseList, visit)
	case *parse.WithNode:
		walkBranch(x.Pipe, x.List, x.ElseList, visit)
	case *parse.PipeNode:
		if x == nil {
			return
		}
		for _, cmd := range x.Cmds {
			visit(cmd)
			for _, arg := range cmd.Args {
				walkNodes(arg, visit)
			}
		}
	}
}

func walkBranch(pipe *parse.PipeNode, list, elseList *parse.ListNode, visit func(*parse.CommandNode)) {
	walkNodes(pipe, visit)
	walkNodes(list, visit)
	walkNodes(elseList, visit)
}
