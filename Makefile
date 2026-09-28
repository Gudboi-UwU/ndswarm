VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)
GO_BUILD := CGO_ENABLED=0 go build -trimpath -ldflags "-s -w -X main.version=$(VERSION)"

.PHONY: dev build check clean

# Go server on :8089, dummy target on :8090, Vite on :5173 (proxies /api to Go). Ctrl+C stops all.
dev: web/node_modules | web/dist
	@trap 'kill 0' INT TERM EXIT; \
	NDSWARM_LOG_LEVEL=debug go run ./cmd/ndswarm & \
	go run ./cmd/dummytarget & \
	npm --prefix web run dev

build: web/node_modules
	npm --prefix web run build
	$(GO_BUILD) -o bin/ndswarm ./cmd/ndswarm
	$(GO_BUILD) -o bin/dummytarget ./cmd/dummytarget

check: web/node_modules | web/dist
	@test -z "$$(gofmt -l cmd internal web/*.go)" || { gofmt -l cmd internal web/*.go; echo "gofmt needed"; exit 1; }
	go vet ./...
	go test ./...
	npm --prefix web run typecheck
	npm --prefix web run lint
	npm --prefix web test

clean:
	rm -rf bin web/dist

web/node_modules: web/package-lock.json
	npm --prefix web ci
	@touch $@

# go:embed needs web/dist to exist; the server shows "UI not built" until `make build`.
web/dist:
	mkdir -p $@ && touch $@/.keep
