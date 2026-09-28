package store

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/Gudboi-UwU/ndswarm/internal/model"
)

// ServerSettings are the admin-editable limits that apply to every run.
type ServerSettings struct {
	RetentionDays   int      `json:"retentionDays"`
	TargetAllowlist []string `json:"targetAllowlist"`
	AllowLinkLocal  bool     `json:"allowLinkLocal"`
}

const (
	keyRetention      = "retention_days"
	keyAllowlist      = "target_allowlist"
	keyAllowLinkLocal = "allow_link_local"
)

// InitServerSettings seeds values from env on first start only.
func (s *Store) InitServerSettings(ctx context.Context, retentionDays int, allowlist string) error {
	if err := s.InitSetting(ctx, keyRetention, strconv.Itoa(retentionDays)); err != nil {
		return err
	}
	return s.InitSetting(ctx, keyAllowlist, strings.Join(SplitHosts(allowlist), ","))
}

func (s *Store) ServerSettings(ctx context.Context) (ServerSettings, error) {
	out := ServerSettings{RetentionDays: 30, TargetAllowlist: []string{}}
	rows, err := s.R.QueryContext(ctx, "SELECT key, value FROM settings WHERE key IN (?, ?, ?)", keyRetention, keyAllowlist, keyAllowLinkLocal)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		var k, v string
		if err := rows.Scan(&k, &v); err != nil {
			return out, err
		}
		switch k {
		case keyRetention:
			if n, err := strconv.Atoi(v); err == nil {
				out.RetentionDays = n
			}
		case keyAllowlist:
			out.TargetAllowlist = SplitHosts(v)
		case keyAllowLinkLocal:
			out.AllowLinkLocal = v == "true"
		}
	}
	return out, rows.Err()
}

func (s *Store) SaveServerSettings(ctx context.Context, in ServerSettings) error {
	var v model.ValidationError
	v.Check(in.RetentionDays >= 1 && in.RetentionDays <= 3650, "retentionDays", "Use 1-3650 days.")
	v.Check(len(in.TargetAllowlist) <= 100, "targetAllowlist", "At most 100 hosts.")
	for i, h := range in.TargetAllowlist {
		rest, _ := strings.CutPrefix(h, "*.") // a wildcard is only allowed as the first label
		v.Check(rest != "" && !strings.ContainsAny(rest, " /:,*"), fmt.Sprintf("targetAllowlist.%d", i),
			"Use a host name like api.example.com or *.example.com, without scheme or port.")
	}
	if err := v.Err(); err != nil {
		return err
	}
	tx, err := s.W.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for k, val := range map[string]string{
		keyRetention:      strconv.Itoa(in.RetentionDays),
		keyAllowlist:      strings.Join(in.TargetAllowlist, ","),
		keyAllowLinkLocal: strconv.FormatBool(in.AllowLinkLocal),
	} {
		if _, err := tx.ExecContext(ctx, "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value", k, val); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// SplitHosts parses a comma or newline separated host list.
func SplitHosts(s string) []string {
	out := []string{}
	for _, h := range strings.FieldsFunc(s, func(r rune) bool { return r == ',' || r == '\n' || r == ' ' }) {
		out = append(out, strings.ToLower(strings.TrimSpace(h)))
	}
	return out
}

// PurgeLogs deletes request logs older than days and returns the space to the file.
func (s *Store) PurgeLogs(ctx context.Context, days int) (int64, error) {
	cutoff := time.Now().Add(-time.Duration(days) * 24 * time.Hour).UnixMilli()
	res, err := s.W.ExecContext(ctx, "DELETE FROM request_logs WHERE t_ms < ?", cutoff)
	if err != nil {
		return 0, err
	}
	n, _ := res.RowsAffected()
	if n > 0 {
		_, err = s.W.ExecContext(ctx, "PRAGMA incremental_vacuum")
	}
	return n, err
}
