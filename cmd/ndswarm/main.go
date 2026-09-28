// Command ndswarm is a UI-driven HTTP load testing tool.
package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/Gudboi-UwU/ndswarm/internal/api"
	"github.com/Gudboi-UwU/ndswarm/internal/auth"
	"github.com/Gudboi-UwU/ndswarm/internal/config"
	"github.com/Gudboi-UwU/ndswarm/internal/engine"
	"github.com/Gudboi-UwU/ndswarm/internal/project"
	"github.com/Gudboi-UwU/ndswarm/internal/secret"
	"github.com/Gudboi-UwU/ndswarm/internal/store"
	"github.com/Gudboi-UwU/ndswarm/web"
)

var version = "dev"

func main() {
	cfg, err := config.Load()
	if err != nil {
		fmt.Fprintln(os.Stderr, "config:", err)
		os.Exit(2)
	}
	cmd := "serve"
	if len(os.Args) > 1 {
		cmd = os.Args[1]
	}
	switch cmd {
	case "serve":
		slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: cfg.LogLevel})))
		if err := serve(cfg); err != nil {
			slog.Error("server stopped", "err", err)
			os.Exit(1)
		}
	case "healthcheck":
		os.Exit(healthcheck(cfg.Addr))
	case "version":
		fmt.Println(version)
	default:
		fmt.Fprintf(os.Stderr, "usage: ndswarm [serve|healthcheck|version]\n")
		os.Exit(2)
	}
}

func serve(cfg config.Config) error {
	if err := os.MkdirAll(cfg.DataDir, 0o700); err != nil {
		return fmt.Errorf("data dir: %w", err)
	}
	key, err := secret.LoadKey(cfg.SecretKey, cfg.DataDir)
	if err != nil {
		return fmt.Errorf("secret key: %w", err)
	}
	box, err := secret.New(key)
	if err != nil {
		return err
	}
	db, err := store.Open(filepath.Join(cfg.DataDir, "ndswarm.db"))
	if err != nil {
		return err
	}
	defer db.Close()
	authSvc := auth.New(db)
	if err := authSvc.Bootstrap(context.Background(), cfg.AdminUser, cfg.AdminPassword, auth.GuestMode(cfg.GuestMode)); err != nil {
		return fmt.Errorf("bootstrap: %w", err)
	}

	engine.UserAgent = "ndswarm/" + version
	server := &api.Server{Auth: authSvc, Projects: project.New(db, box), Store: db, UI: web.Dist(), Version: version}
	srv := &http.Server{
		Addr:              cfg.Addr,
		Handler:           server.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	errc := make(chan error, 1)
	go func() { errc <- srv.ListenAndServe() }()
	slog.Info("ndswarm listening", "addr", cfg.Addr, "dataDir", cfg.DataDir, "version", version)

	select {
	case err := <-errc:
		return err
	case <-ctx.Done():
	}
	slog.Info("shutting down")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}

// healthcheck probes /healthz on the local listener; used by the container HEALTHCHECK.
func healthcheck(addr string) int {
	host, port, err := net.SplitHostPort(addr)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	if host == "" || host == "0.0.0.0" || host == "::" {
		host = "127.0.0.1"
	}
	client := http.Client{Timeout: 3 * time.Second}
	res, err := client.Get("http://" + net.JoinHostPort(host, port) + "/healthz")
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	res.Body.Close()
	if res.StatusCode != http.StatusOK {
		fmt.Fprintln(os.Stderr, "healthz:", res.Status)
		return 1
	}
	return 0
}
