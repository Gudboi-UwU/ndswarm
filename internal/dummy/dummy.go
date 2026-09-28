// Package dummy is a predictable HTTP target for demos, tests and benchmarks.
//
//	GET  /fast             200 immediately
//	GET  /slow?ms=50       200 after ms milliseconds (max 60000)
//	GET  /flaky?err=0.2    500 with probability err (0..1)
//	ANY  /echo             returns method, path, query, headers and body as JSON
//	POST /login            {"username":"demo","password":"demo"} -> {"token":"..."}
//	GET  /me               requires "Authorization: Bearer <token>"
package dummy

import (
	"crypto/hmac"
	crand "crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"math/rand/v2"
	"net/http"
	"strconv"
	"strings"
	"time"
)

const (
	User     = "demo"
	Password = "demo"
)

// Handler returns the dummy target mux. Tokens are stateless (HMAC of the username with a
// per-handler key) so heavy login traffic does not grow memory.
func Handler() http.Handler {
	key := make([]byte, 32)
	crand.Read(key)
	sign := func(user string) string {
		m := hmac.New(sha256.New, key)
		m.Write([]byte(user))
		return hex.EncodeToString(m.Sum(nil))
	}
	mux := http.NewServeMux()

	mux.HandleFunc("GET /fast", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	})

	mux.HandleFunc("GET /slow", func(w http.ResponseWriter, r *http.Request) {
		ms, err := strconv.Atoi(r.URL.Query().Get("ms"))
		if err != nil || ms < 0 || ms > 60000 {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "ms must be 0..60000"})
			return
		}
		select {
		case <-time.After(time.Duration(ms) * time.Millisecond):
		case <-r.Context().Done():
			return
		}
		writeJSON(w, http.StatusOK, map[string]int{"sleptMs": ms})
	})

	mux.HandleFunc("GET /flaky", func(w http.ResponseWriter, r *http.Request) {
		p, err := strconv.ParseFloat(r.URL.Query().Get("err"), 64)
		if err != nil || p < 0 || p > 1 {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "err must be 0..1"})
			return
		}
		if rand.Float64() < p {
			writeJSON(w, http.StatusInternalServerError, map[string]bool{"ok": false})
			return
		}
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	})

	mux.HandleFunc("/echo", func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(io.LimitReader(r.Body, 1<<20))
		writeJSON(w, http.StatusOK, map[string]any{
			"method":  r.Method,
			"path":    r.URL.Path,
			"query":   r.URL.Query(),
			"headers": r.Header,
			"body":    string(body),
		})
	})

	mux.HandleFunc("POST /login", func(w http.ResponseWriter, r *http.Request) {
		var in struct{ Username, Password string }
		if json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&in) != nil || in.Username != User || in.Password != Password {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid credentials"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"token": sign(in.Username)})
	})

	mux.HandleFunc("GET /me", func(w http.ResponseWriter, r *http.Request) {
		token, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
		if !ok || !hmac.Equal([]byte(token), []byte(sign(User))) {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "missing or invalid token"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"username": User})
	})

	return mux
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}
