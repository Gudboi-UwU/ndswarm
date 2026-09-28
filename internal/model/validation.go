// Package model holds the domain types shared by the API, engine and UI, and their validation.
package model

import "strings"

// FieldError points at one invalid input field. Path uses dots, e.g. "flows.0.steps.1.url".
type FieldError struct {
	Path    string `json:"path"`
	Message string `json:"message"`
}

// ValidationError lists every invalid field so the UI can mark all of them at once.
type ValidationError []FieldError

func (v ValidationError) Error() string {
	msgs := make([]string, len(v))
	for i, e := range v {
		msgs[i] = e.Path + ": " + e.Message
	}
	return "invalid input: " + strings.Join(msgs, "; ")
}

// Check records a field error when cond is false.
func (v *ValidationError) Check(cond bool, path, msg string) {
	if !cond {
		*v = append(*v, FieldError{path, msg})
	}
}

// Err returns v as an error, or nil when empty.
func (v ValidationError) Err() error {
	if len(v) == 0 {
		return nil
	}
	return v
}
