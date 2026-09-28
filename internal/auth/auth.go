// Package auth manages users, sessions, roles and guest access.
package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"errors"
	"regexp"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/bcrypt"

	"github.com/Gudboi-UwU/ndswarm/internal/model"
	"github.com/Gudboi-UwU/ndswarm/internal/store"
)

type Role string

const (
	Admin  Role = "admin"
	Editor Role = "editor"
	Viewer Role = "viewer"
)

type GuestMode string

const (
	GuestOff  GuestMode = "off"
	GuestView GuestMode = "view" // see dashboard, runs and logs without logging in
	GuestRun  GuestMode = "run"  // view + start existing tests
)

// Perm is what a request needs; roles and guest mode grant them.
type Perm int

const (
	PermView  Perm = iota // read projects, tests, runs
	PermRun               // start/stop runs
	PermEdit              // create/change projects, environments, tests
	PermAdmin             // users and settings
)

const (
	SessionTTL       = 7 * 24 * time.Hour
	MinPasswordLen   = 8
	maxPasswordLen   = 72 // bcrypt ignores bytes past 72
	loginPerMinute   = 10
	guestModeSetting = "guest_mode"
)

var (
	ErrInvalidCredentials = errors.New("invalid username or password")
	ErrRateLimited        = errors.New("too many login attempts, try again in a minute")
	ErrSetupDone          = errors.New("setup already completed")
	ErrUsernameTaken      = errors.New("username already exists")
	ErrNotFound           = errors.New("user not found")
	ErrLastAdmin          = errors.New("at least one admin must remain")
	ErrSelfDelete         = errors.New("you cannot delete your own account")
)

type User struct {
	ID        int64  `json:"id"`
	Username  string `json:"username"`
	Role      Role   `json:"role"`
	CreatedAt int64  `json:"createdAt"`
}

// Principal is who is making a request: a logged-in user, or a guest when User is nil.
type Principal struct {
	User  *User
	Guest GuestMode
}

func (p Principal) Can(perm Perm) bool {
	if p.User != nil {
		switch p.User.Role {
		case Admin:
			return true
		case Editor:
			return perm <= PermEdit
		case Viewer:
			return perm == PermView
		}
		return false
	}
	switch p.Guest {
	case GuestView:
		return perm == PermView
	case GuestRun:
		return perm <= PermRun
	}
	return false
}

type Service struct {
	db      *store.Store
	limiter *limiter
	now     func() time.Time
}

func New(db *store.Store) *Service {
	return &Service{db: db, limiter: &limiter{hits: map[string]*window{}}, now: time.Now}
}

// Bootstrap seeds the initial guest mode and, when there are no users yet, the admin from env.
func (s *Service) Bootstrap(ctx context.Context, adminUser, adminPassword string, guest GuestMode) error {
	if err := s.db.InitSetting(ctx, guestModeSetting, string(guest)); err != nil {
		return err
	}
	if adminUser == "" {
		return nil
	}
	_, err := s.Setup(ctx, adminUser, adminPassword)
	if errors.Is(err, ErrSetupDone) {
		return nil
	}
	return err
}

func (s *Service) SetupRequired(ctx context.Context) (bool, error) {
	var n int
	err := s.db.R.QueryRowContext(ctx, "SELECT count(*) FROM users").Scan(&n)
	return n == 0, err
}

// Setup creates the first admin. It fails with ErrSetupDone once any user exists,
// atomically, so two concurrent setup requests cannot both succeed.
func (s *Service) Setup(ctx context.Context, username, password string) (User, error) {
	u, hash, err := s.newUser(username, password, Admin)
	if err != nil {
		return User{}, err
	}
	res, err := s.db.W.ExecContext(ctx,
		`INSERT INTO users (username, password_hash, role, created_at)
		 SELECT ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM users)`,
		u.Username, hash, u.Role, u.CreatedAt)
	if err != nil {
		return User{}, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return User{}, ErrSetupDone
	}
	u.ID, _ = res.LastInsertId()
	return u, nil
}

// Login checks credentials and returns a new session token (store only in the cookie).
func (s *Service) Login(ctx context.Context, username, password string) (string, User, error) {
	// ponytail: per-username limit, not per-IP: behind an ingress every client shares one IP.
	if !s.limiter.allow(strings.ToLower(username), loginPerMinute, s.now()) {
		return "", User{}, ErrRateLimited
	}
	var u User
	var hash string
	err := s.db.R.QueryRowContext(ctx,
		"SELECT id, username, role, created_at, password_hash FROM users WHERE username = ?", username).
		Scan(&u.ID, &u.Username, &u.Role, &u.CreatedAt, &hash)
	if errors.Is(err, sql.ErrNoRows) {
		bcrypt.CompareHashAndPassword(dummyHash, []byte(password)) // same timing as a real user
		return "", User{}, ErrInvalidCredentials
	}
	if err != nil {
		return "", User{}, err
	}
	if bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) != nil {
		return "", User{}, ErrInvalidCredentials
	}

	token := make([]byte, 32)
	rand.Read(token)
	now := s.now()
	if _, err := s.db.W.ExecContext(ctx, "DELETE FROM sessions WHERE expires_at < ?", now.UnixMilli()); err != nil {
		return "", User{}, err
	}
	if _, err := s.db.W.ExecContext(ctx, "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)",
		hashToken(string(token)), u.ID, now.Add(SessionTTL).UnixMilli()); err != nil {
		return "", User{}, err
	}
	return base64.RawURLEncoding.EncodeToString(token), u, nil
}

func (s *Service) Logout(ctx context.Context, token string) error {
	raw, err := base64.RawURLEncoding.DecodeString(token)
	if err != nil {
		return nil
	}
	_, err = s.db.W.ExecContext(ctx, "DELETE FROM sessions WHERE token_hash = ?", hashToken(string(raw)))
	return err
}

// UserByToken returns the session's user, or nil for a missing/expired/unknown token.
func (s *Service) UserByToken(ctx context.Context, token string) (*User, error) {
	raw, err := base64.RawURLEncoding.DecodeString(token)
	if err != nil || len(raw) != 32 {
		return nil, nil
	}
	var u User
	err = s.db.R.QueryRowContext(ctx,
		`SELECT u.id, u.username, u.role, u.created_at FROM sessions s JOIN users u ON u.id = s.user_id
		 WHERE s.token_hash = ? AND s.expires_at > ?`, hashToken(string(raw)), s.now().UnixMilli()).
		Scan(&u.ID, &u.Username, &u.Role, &u.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &u, nil
}

func (s *Service) GuestMode(ctx context.Context) (GuestMode, error) {
	v, err := s.db.Setting(ctx, guestModeSetting, string(GuestOff))
	return GuestMode(v), err
}

func (s *Service) SetGuestMode(ctx context.Context, m GuestMode) error {
	var v model.ValidationError
	v.Check(m == GuestOff || m == GuestView || m == GuestRun, "guestMode", "Choose off, view or run.")
	if err := v.Err(); err != nil {
		return err
	}
	return s.db.SetSetting(ctx, guestModeSetting, string(m))
}

func (s *Service) ListUsers(ctx context.Context) ([]User, error) {
	rows, err := s.db.R.QueryContext(ctx, "SELECT id, username, role, created_at FROM users ORDER BY username")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	users := []User{}
	for rows.Next() {
		var u User
		if err := rows.Scan(&u.ID, &u.Username, &u.Role, &u.CreatedAt); err != nil {
			return nil, err
		}
		users = append(users, u)
	}
	return users, rows.Err()
}

func (s *Service) CreateUser(ctx context.Context, username, password string, role Role) (User, error) {
	u, hash, err := s.newUser(username, password, role)
	if err != nil {
		return User{}, err
	}
	res, err := s.db.W.ExecContext(ctx, "INSERT INTO users (username, password_hash, role, created_at) VALUES (?, ?, ?, ?)",
		u.Username, hash, u.Role, u.CreatedAt)
	if isUnique(err) {
		return User{}, ErrUsernameTaken
	}
	if err != nil {
		return User{}, err
	}
	u.ID, _ = res.LastInsertId()
	return u, nil
}

// UserUpdate changes only the non-nil fields.
type UserUpdate struct {
	Role     *Role   `json:"role"`
	Password *string `json:"password"`
}

// UpdateUser applies upd. A password change ends the user's other sessions (keepToken survives).
func (s *Service) UpdateUser(ctx context.Context, id int64, upd UserUpdate, keepToken string) (User, error) {
	var v model.ValidationError
	if upd.Role != nil {
		v.Check(validRole(*upd.Role), "role", "Choose admin, editor or viewer.")
	}
	var hash []byte
	if upd.Password != nil {
		checkPassword(&v, *upd.Password)
		if len(v) == 0 {
			hash, _ = bcrypt.GenerateFromPassword([]byte(*upd.Password), bcrypt.DefaultCost)
		}
	}
	if err := v.Err(); err != nil {
		return User{}, err
	}

	tx, err := s.db.W.BeginTx(ctx, nil)
	if err != nil {
		return User{}, err
	}
	defer tx.Rollback()
	var u User
	err = tx.QueryRowContext(ctx, "SELECT id, username, role, created_at FROM users WHERE id = ?", id).
		Scan(&u.ID, &u.Username, &u.Role, &u.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return User{}, ErrNotFound
	}
	if err != nil {
		return User{}, err
	}
	if upd.Role != nil && *upd.Role != u.Role {
		if u.Role == Admin {
			if err := lastAdminCheck(ctx, tx); err != nil {
				return User{}, err
			}
		}
		if _, err := tx.ExecContext(ctx, "UPDATE users SET role = ? WHERE id = ?", *upd.Role, id); err != nil {
			return User{}, err
		}
		u.Role = *upd.Role
	}
	if hash != nil {
		if _, err := tx.ExecContext(ctx, "UPDATE users SET password_hash = ? WHERE id = ?", hash, id); err != nil {
			return User{}, err
		}
		keep := []byte{}
		if raw, err := base64.RawURLEncoding.DecodeString(keepToken); err == nil {
			keep = hashToken(string(raw))
		}
		if _, err := tx.ExecContext(ctx, "DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?", id, keep); err != nil {
			return User{}, err
		}
	}
	return u, tx.Commit()
}

func (s *Service) DeleteUser(ctx context.Context, id, actorID int64) error {
	if id == actorID {
		return ErrSelfDelete
	}
	tx, err := s.db.W.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var role Role
	err = tx.QueryRowContext(ctx, "SELECT role FROM users WHERE id = ?", id).Scan(&role)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if role == Admin {
		if err := lastAdminCheck(ctx, tx); err != nil {
			return err
		}
	}
	if _, err := tx.ExecContext(ctx, "DELETE FROM users WHERE id = ?", id); err != nil {
		return err
	}
	return tx.Commit()
}

// lastAdminCheck fails when removing one admin would leave none.
func lastAdminCheck(ctx context.Context, tx *sql.Tx) error {
	var admins int
	if err := tx.QueryRowContext(ctx, "SELECT count(*) FROM users WHERE role = 'admin'").Scan(&admins); err != nil {
		return err
	}
	if admins <= 1 {
		return ErrLastAdmin
	}
	return nil
}

var usernameRe = regexp.MustCompile(`^[A-Za-z0-9._-]{3,32}$`)

func (s *Service) newUser(username, password string, role Role) (User, []byte, error) {
	var v model.ValidationError
	v.Check(usernameRe.MatchString(username), "username", "Use 3-32 letters, digits, dots, underscores or dashes.")
	checkPassword(&v, password)
	v.Check(validRole(role), "role", "Choose admin, editor or viewer.")
	if err := v.Err(); err != nil {
		return User{}, nil, err
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return User{}, nil, err
	}
	return User{Username: username, Role: role, CreatedAt: s.now().UnixMilli()}, hash, nil
}

func checkPassword(v *model.ValidationError, p string) {
	v.Check(len(p) >= MinPasswordLen, "password", "Use at least 8 characters.")
	v.Check(len(p) <= maxPasswordLen, "password", "Use at most 72 bytes.")
}

func validRole(r Role) bool { return r == Admin || r == Editor || r == Viewer }

func hashToken(raw string) []byte {
	h := sha256.Sum256([]byte(raw))
	return h[:]
}

func isUnique(err error) bool {
	return err != nil && strings.Contains(err.Error(), "UNIQUE constraint failed")
}

var dummyHash, _ = bcrypt.GenerateFromPassword([]byte("timing-equalizer"), bcrypt.DefaultCost)

// limiter is a fixed one-minute window per key.
type limiter struct {
	mu   sync.Mutex
	hits map[string]*window
}

type window struct {
	start time.Time
	n     int
}

func (l *limiter) allow(key string, max int, now time.Time) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	if len(l.hits) > 10000 { // bound memory under username spraying
		l.hits = map[string]*window{}
	}
	w := l.hits[key]
	if w == nil || now.Sub(w.start) >= time.Minute {
		w = &window{start: now}
		l.hits[key] = w
	}
	w.n++
	return w.n <= max
}
