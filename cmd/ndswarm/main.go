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
	"strings"
	"syscall"
	"time"

	"github.com/Gudboi-UwU/ndswarm/internal/api"
	"github.com/Gudboi-UwU/ndswarm/web"
)

var version = "dev"

func main() {
	addr := env("NDSWARM_ADDR", ":8089")
	cmd := "serve"
	if len(os.Args) > 1 {
		cmd = os.Args[1]
	}
	switch cmd {
	case "serve":
		if err := serve(addr); err != nil {
			slog.Error("server stopped", "err", err)
			os.Exit(1)
		}
	case "healthcheck":
		os.Exit(healthcheck(addr))
	case "version":
		fmt.Println(version)
	default:
		fmt.Fprintf(os.Stderr, "usage: ndswarm [serve|healthcheck|version]\n")
		os.Exit(2)
	}
}

func serve(addr string) error {
	var level slog.Level
	if err := level.UnmarshalText([]byte(env("NDSWARM_LOG_LEVEL", "info"))); err != nil {
		return fmt.Errorf("NDSWARM_LOG_LEVEL: %w", err)
	}
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: level})))

	srv := &http.Server{
		Addr:              addr,
		Handler:           api.NewRouter(web.Dist()),
		ReadHeaderTimeout: 10 * time.Second,
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	errc := make(chan error, 1)
	go func() { errc <- srv.ListenAndServe() }()
	slog.Info("ndswarm listening", "addr", addr, "version", version)

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

func env(key, def string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return def
}
