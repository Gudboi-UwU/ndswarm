package api

import (
	"context"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"github.com/Gudboi-UwU/ndswarm/internal/auth"
)

const sessionCookie = "ndswarm_session"

type ctxKey struct{}

func principalFrom(ctx context.Context) auth.Principal {
	p, _ := ctx.Value(ctxKey{}).(auth.Principal)
	return p
}

// csrf rejects state-changing requests without the custom header. Browsers cannot add it
// cross-site without a CORS preflight, which this server never approves.
func csrf(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet, http.MethodHead, http.MethodOptions:
		default:
			if r.Header.Get("X-Requested-With") != "ndswarm" {
				writeError(w, http.StatusForbidden, "csrf", "missing X-Requested-With: ndswarm header", nil)
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

// principal resolves the session cookie (or guest access) into the request context.
func (s *Server) principal(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var p auth.Principal
		if c, err := r.Cookie(sessionCookie); err == nil {
			u, err := s.Auth.UserByToken(r.Context(), c.Value)
			if err != nil {
				fail(w, r, err)
				return
			}
			p.User = u
		}
		mode, err := s.Auth.GuestMode(r.Context())
		if err != nil {
			fail(w, r, err)
			return
		}
		p.Guest = mode
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), ctxKey{}, p)))
	})
}

func require(perm auth.Perm) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			p := principalFrom(r.Context())
			switch {
			case p.Can(perm):
				next.ServeHTTP(w, r)
			case p.User == nil:
				writeError(w, http.StatusUnauthorized, "unauthorized", "log in to continue", nil)
			default:
				writeError(w, http.StatusForbidden, "forbidden", "your role does not allow this action", nil)
			}
		})
	}
}

type credentials struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

func (s *Server) setup(w http.ResponseWriter, r *http.Request) {
	var in credentials
	if !readJSON(w, r, &in) {
		return
	}
	if _, err := s.Auth.Setup(r.Context(), in.Username, in.Password); err != nil {
		fail(w, r, err)
		return
	}
	s.startSession(w, r, in, http.StatusCreated)
}

func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	var in credentials
	if !readJSON(w, r, &in) {
		return
	}
	s.startSession(w, r, in, http.StatusOK)
}

func (s *Server) startSession(w http.ResponseWriter, r *http.Request, in credentials, status int) {
	token, u, err := s.Auth.Login(r.Context(), in.Username, in.Password)
	if err != nil {
		fail(w, r, err)
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookie,
		Value:    token,
		Path:     "/",
		MaxAge:   int(auth.SessionTTL.Seconds()),
		HttpOnly: true,
		Secure:   isHTTPS(r),
		SameSite: http.SameSiteLaxMode,
	})
	writeJSON(w, status, map[string]any{"user": u})
}

func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(sessionCookie); err == nil {
		if err := s.Auth.Logout(r.Context(), c.Value); err != nil {
			fail(w, r, err)
			return
		}
	}
	http.SetCookie(w, &http.Cookie{Name: sessionCookie, Path: "/", MaxAge: -1, HttpOnly: true, Secure: isHTTPS(r), SameSite: http.SameSiteLaxMode})
	w.WriteHeader(http.StatusNoContent)
}

// me tells the SPA who is looking and what they may do; it never returns 401.
func (s *Server) me(w http.ResponseWriter, r *http.Request) {
	p := principalFrom(r.Context())
	setup, err := s.Auth.SetupRequired(r.Context())
	if err != nil {
		fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"user":          p.User,
		"guestMode":     p.Guest,
		"setupRequired": setup,
		"can": map[string]bool{
			"view":  p.Can(auth.PermView),
			"run":   p.Can(auth.PermRun),
			"edit":  p.Can(auth.PermEdit),
			"admin": p.Can(auth.PermAdmin),
		},
	})
}

func (s *Server) listUsers(w http.ResponseWriter, r *http.Request) {
	users, err := s.Auth.ListUsers(r.Context())
	if err != nil {
		fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, users)
}

func (s *Server) createUser(w http.ResponseWriter, r *http.Request) {
	var in struct {
		credentials
		Role auth.Role `json:"role"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	u, err := s.Auth.CreateUser(r.Context(), in.Username, in.Password, in.Role)
	if err != nil {
		fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, u)
}

func (s *Server) updateUser(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var in auth.UserUpdate
	if !readJSON(w, r, &in) {
		return
	}
	var keep string
	if c, err := r.Cookie(sessionCookie); err == nil {
		keep = c.Value
	}
	u, err := s.Auth.UpdateUser(r.Context(), id, in, keep)
	if err != nil {
		fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, u)
}

func (s *Server) deleteUser(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	if err := s.Auth.DeleteUser(r.Context(), id, principalFrom(r.Context()).User.ID); err != nil {
		fail(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type settings struct {
	GuestMode auth.GuestMode `json:"guestMode"`
}

func (s *Server) getSettings(w http.ResponseWriter, r *http.Request) {
	mode, err := s.Auth.GuestMode(r.Context())
	if err != nil {
		fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, settings{GuestMode: mode})
}

func (s *Server) patchSettings(w http.ResponseWriter, r *http.Request) {
	var in struct {
		GuestMode *auth.GuestMode `json:"guestMode"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	if in.GuestMode != nil {
		if err := s.Auth.SetGuestMode(r.Context(), *in.GuestMode); err != nil {
			fail(w, r, err)
			return
		}
	}
	s.getSettings(w, r)
}

func pathID(w http.ResponseWriter, r *http.Request) (int64, bool) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusNotFound, "not_found", "no such id", nil)
		return 0, false
	}
	return id, true
}

func isHTTPS(r *http.Request) bool {
	return r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https"
}
