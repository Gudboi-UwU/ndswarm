// Package config reads NDSWARM_* environment variables.
package config

import (
	"fmt"
	"log/slog"
	"os"
	"strconv"
	"strings"
)

type Config struct {
	Addr          string
	DataDir       string
	AdminUser     string
	AdminPassword string
	SecretKey     string // base64, 32 bytes; empty = auto-generate in DataDir
	GuestMode     string // initial value only; admins change it in Settings
	MaxVUs        int
	LogLevel      slog.Level
}

func Load() (Config, error) {
	c := Config{
		Addr:          get("NDSWARM_ADDR", ":8089"),
		DataDir:       get("NDSWARM_DATA_DIR", "/data"),
		AdminUser:     get("NDSWARM_ADMIN_USER", ""),
		AdminPassword: os.Getenv("NDSWARM_ADMIN_PASSWORD"),
		SecretKey:     get("NDSWARM_SECRET_KEY", ""),
		GuestMode:     get("NDSWARM_GUEST_MODE", "off"),
	}
	maxVUs, err := strconv.Atoi(get("NDSWARM_MAX_VUS", "5000"))
	if err != nil || maxVUs < 1 {
		return c, fmt.Errorf("NDSWARM_MAX_VUS must be a positive number")
	}
	c.MaxVUs = maxVUs
	if err := c.LogLevel.UnmarshalText([]byte(get("NDSWARM_LOG_LEVEL", "info"))); err != nil {
		return c, fmt.Errorf("NDSWARM_LOG_LEVEL: %w", err)
	}
	switch c.GuestMode {
	case "off", "view", "run":
	default:
		return c, fmt.Errorf("NDSWARM_GUEST_MODE must be off, view or run, got %q", c.GuestMode)
	}
	if (c.AdminUser == "") != (c.AdminPassword == "") {
		return c, fmt.Errorf("set both NDSWARM_ADMIN_USER and NDSWARM_ADMIN_PASSWORD, or neither")
	}
	return c, nil
}

func get(key, def string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return def
}
