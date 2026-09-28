package auth

import (
	"context"
	"errors"
	"path/filepath"
	"testing"
	"time"

	"github.com/Gudboi-UwU/ndswarm/internal/model"
	"github.com/Gudboi-UwU/ndswarm/internal/store"
)

func newService(t *testing.T) *Service {
	t.Helper()
	db, err := store.Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	return New(db)
}

func TestPermissions(t *testing.T) {
	user := func(r Role) Principal { return Principal{User: &User{Role: r}} }
	cases := []struct {
		name string
		p    Principal
		want [4]bool // view, run, edit, admin
	}{
		{"admin", user(Admin), [4]bool{true, true, true, true}},
		{"editor", user(Editor), [4]bool{true, true, true, false}},
		{"viewer", user(Viewer), [4]bool{true, false, false, false}},
		{"guest off", Principal{Guest: GuestOff}, [4]bool{}},
		{"guest view", Principal{Guest: GuestView}, [4]bool{true, false, false, false}},
		{"guest run", Principal{Guest: GuestRun}, [4]bool{true, true, false, false}},
		{"no session", Principal{}, [4]bool{}},
	}
	for _, c := range cases {
		for perm := PermView; perm <= PermAdmin; perm++ {
			if got := c.p.Can(perm); got != c.want[perm] {
				t.Errorf("%s: Can(%d) = %v, want %v", c.name, perm, got, c.want[perm])
			}
		}
	}
}

func TestSetupLoginSessions(t *testing.T) {
	ctx := context.Background()
	s := newService(t)

	if req, _ := s.SetupRequired(ctx); !req {
		t.Fatal("fresh DB should require setup")
	}
	var v model.ValidationError
	if _, err := s.Setup(ctx, "a", "short"); !errors.As(err, &v) || len(v) != 2 {
		t.Errorf("weak setup input: %v", err)
	}
	admin, err := s.Setup(ctx, "admin", "password1")
	if err != nil || admin.Role != Admin {
		t.Fatalf("setup: %v %+v", err, admin)
	}
	if _, err := s.Setup(ctx, "other", "password1"); !errors.Is(err, ErrSetupDone) {
		t.Errorf("second setup: %v", err)
	}

	if _, _, err := s.Login(ctx, "admin", "wrong-pass"); !errors.Is(err, ErrInvalidCredentials) {
		t.Errorf("wrong password: %v", err)
	}
	if _, _, err := s.Login(ctx, "ghost", "password1"); !errors.Is(err, ErrInvalidCredentials) {
		t.Errorf("unknown user: %v", err)
	}
	token, _, err := s.Login(ctx, "ADMIN", "password1") // usernames are case-insensitive
	if err != nil {
		t.Fatal(err)
	}
	if u, _ := s.UserByToken(ctx, token); u == nil || u.ID != admin.ID {
		t.Errorf("UserByToken: %+v", u)
	}
	if u, _ := s.UserByToken(ctx, "garbage"); u != nil {
		t.Error("garbage token accepted")
	}

	// Expiry.
	s.now = func() time.Time { return time.Now().Add(SessionTTL + time.Minute) }
	if u, _ := s.UserByToken(ctx, token); u != nil {
		t.Error("expired session accepted")
	}
	s.now = time.Now

	s.Logout(ctx, token)
	if u, _ := s.UserByToken(ctx, token); u != nil {
		t.Error("session alive after logout")
	}
}

func TestLoginRateLimit(t *testing.T) {
	ctx := context.Background()
	s := newService(t)
	s.Setup(ctx, "admin", "password1")
	for range loginPerMinute {
		s.Login(ctx, "admin", "wrong-pass")
	}
	if _, _, err := s.Login(ctx, "admin", "password1"); !errors.Is(err, ErrRateLimited) {
		t.Errorf("11th attempt: %v", err)
	}
	s.now = func() time.Time { return time.Now().Add(time.Minute) }
	if _, _, err := s.Login(ctx, "admin", "password1"); err != nil {
		t.Errorf("after window: %v", err)
	}
}

func TestUserManagement(t *testing.T) {
	ctx := context.Background()
	s := newService(t)
	admin, _ := s.Setup(ctx, "admin", "password1")

	viewer, err := s.CreateUser(ctx, "vera", "password1", Viewer)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateUser(ctx, "VERA", "password1", Viewer); !errors.Is(err, ErrUsernameTaken) {
		t.Errorf("duplicate username: %v", err)
	}
	if _, err := s.CreateUser(ctx, "bad", "password1", "root"); err == nil {
		t.Error("accepted unknown role")
	}

	// Last admin cannot be demoted or deleted; self-delete is blocked.
	editor := Editor
	if _, err := s.UpdateUser(ctx, admin.ID, UserUpdate{Role: &editor}, ""); !errors.Is(err, ErrLastAdmin) {
		t.Errorf("demote last admin: %v", err)
	}
	if err := s.DeleteUser(ctx, admin.ID, admin.ID); !errors.Is(err, ErrSelfDelete) {
		t.Errorf("self delete: %v", err)
	}
	adminRole := Admin
	if _, err := s.UpdateUser(ctx, viewer.ID, UserUpdate{Role: &adminRole}, ""); err != nil {
		t.Fatal(err)
	}
	if err := s.DeleteUser(ctx, admin.ID, viewer.ID); err != nil {
		t.Errorf("delete one of two admins: %v", err)
	}
	if err := s.DeleteUser(ctx, viewer.ID, 0); !errors.Is(err, ErrLastAdmin) {
		t.Errorf("delete last admin: %v", err)
	}

	// Password change ends other sessions but keeps the caller's.
	t1, _, _ := s.Login(ctx, "vera", "password1")
	t2, _, _ := s.Login(ctx, "vera", "password1")
	pw := "new-password"
	if _, err := s.UpdateUser(ctx, viewer.ID, UserUpdate{Password: &pw}, t1); err != nil {
		t.Fatal(err)
	}
	if u, _ := s.UserByToken(ctx, t1); u == nil {
		t.Error("caller session dropped")
	}
	if u, _ := s.UserByToken(ctx, t2); u != nil {
		t.Error("other session survived password change")
	}
	if _, _, err := s.Login(ctx, "vera", pw); err != nil {
		t.Errorf("login with new password: %v", err)
	}
}

func TestBootstrapAndGuestMode(t *testing.T) {
	ctx := context.Background()
	s := newService(t)
	if err := s.Bootstrap(ctx, "root", "password1", GuestView); err != nil {
		t.Fatal(err)
	}
	if err := s.Bootstrap(ctx, "root", "password1", GuestRun); err != nil { // restart: no-op
		t.Fatal(err)
	}
	if m, _ := s.GuestMode(ctx); m != GuestView {
		t.Errorf("env must only seed guest mode, got %q", m)
	}
	if users, _ := s.ListUsers(ctx); len(users) != 1 || users[0].Role != Admin {
		t.Errorf("bootstrap users: %+v", users)
	}
	if err := s.SetGuestMode(ctx, "public"); err == nil {
		t.Error("accepted bad guest mode")
	}
	s.SetGuestMode(ctx, GuestRun)
	if m, _ := s.GuestMode(ctx); m != GuestRun {
		t.Errorf("guest mode %q", m)
	}
}
