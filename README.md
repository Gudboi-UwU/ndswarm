# ndswarm

Load testing for HTTP APIs, configured entirely in the browser. Describe endpoints, bodies and
load in a UI; watch requests per second, latency percentiles and errors live; dig into every
error and sampled request afterwards. One container, one SQLite file, no code to write.

## Quick start

```bash
git clone https://github.com/Gudboi-UwU/ndswarm && cd ndswarm
docker compose -f deploy/docker-compose.yml up -d
open http://localhost:8089   # create the admin account, then open the "Demo shop" project
```

The compose file also starts a small dummy target, and seeds a demo test against it, so you
can press **Start** right away. To test your own service, add an environment with its base URL
in a project.

Plain Docker, without the demo (after `make image`, or with your registry image):

```bash
docker run -d -p 8089:8089 -v ndswarm-data:/data --ulimit nofile=65536:65536 ndswarm:dev
```

## What you get

- **Test builder.** Many endpoints per test, each with method, URL, query, headers and one or
  more body variants (JSON fields with real types, form, multipart, or raw text). Every value
  can be static or generated: `{{uuid}}`, `{{int 1 100}}`, `{{email}}`, `{{date ...}}`,
  `{{var "token"}}` and more, picked from a menu with a live preview. **Try** sends one real
  request and shows the response with a timing waterfall.
- **Environments.** Base URL, variables, default headers and auth per target. Secrets are
  encrypted at rest (AES-GCM) and never sent back to the browser.
- **Load.** Virtual users ramp between stages (presets: smoke, load, stress, spike, soak).
  Preflight renders every body and calls each endpoint once before a run starts.
- **Live results.** Average, p95 and p99 latency, OK and error counts, requests per second and
  virtual users, updated every second, per endpoint and in total.
- **After the run.** Errors grouped by message with an example request, a request log
  (every error up to 50 per endpoint per second, sampled successes, the slowest request),
  exact per-interval percentiles, status codes per endpoint, run history, CSV/JSON export.
- **Access.** Admin, editor and viewer roles; optional guest access (view, or view and run).
  Admins can restrict target hosts; link-local addresses (cloud metadata) are blocked by default.

## Performance

`make bench` runs one ndswarm container against the dummy target, both limited to 4 CPU
cores by the compose file, with 100 virtual users on `GET /fast`. On an 8-core laptop:

| Metric | Result |
|---|---|
| Steady-state rate | ~57,700 req/s (median over 26 s), 0 errors |
| p99 latency | ~7 ms |
| CPU needed for 20,000 req/s | ~35% of the 4 cores |

One instance targets up to 20,000 req/s. Numbers depend on the target and on body sizes.

## Configuration

All settings are environment variables. Values marked *initial* only seed the database;
change them later in **Settings**.

| Variable | Default | Purpose |
|---|---|---|
| `NDSWARM_ADDR` | `:8089` | listen address |
| `NDSWARM_DATA_DIR` | `/data` | database and generated secret key |
| `NDSWARM_ADMIN_USER`, `NDSWARM_ADMIN_PASSWORD` | | create the admin on first start instead of the setup page |
| `NDSWARM_SECRET_KEY` | generated in the data dir | key for environment secrets (`openssl rand -base64 32`) |
| `NDSWARM_GUEST_MODE` | `off` | *initial* guest access: `off`, `view` or `run` |
| `NDSWARM_MAX_VUS` | `5000` | upper limit for virtual users per test |
| `NDSWARM_RETENTION_DAYS` | `30` | *initial* days to keep request logs |
| `NDSWARM_TARGET_ALLOWLIST` | any host | *initial* comma separated hosts (`*.example.com` allowed) |
| `NDSWARM_DEMO` | `false` | seed the demo project on first start |
| `NDSWARM_DEMO_TARGET` | `http://dummytarget:8090` | base URL used by the demo |
| `NDSWARM_LOG_LEVEL` | `info` | JSON log level on stdout |

Keep the data directory on a volume. Losing `secret.key` (when `NDSWARM_SECRET_KEY` is not set)
makes stored secrets unreadable.

## Kubernetes

```bash
helm install ndswarm deploy/helm/ndswarm --namespace ndswarm --create-namespace \
  --set image.repository=<your-registry>/ndswarm --set image.tag=<tag>
kubectl -n ndswarm port-forward svc/ndswarm 8089:8089
```

Or without Helm: `kubectl create namespace ndswarm && kubectl -n ndswarm apply -f deploy/k8s/ndswarm.yaml`.

The chart runs exactly one replica with the `Recreate` strategy, because SQLite allows one
writer. Data lives on a 10 Gi PVC. The pod runs as non-root with a read-only root filesystem.
Enable `ingress.enabled` for an Ingress; its default annotations keep the live-results
WebSocket open for long runs on ingress-nginx.

## Development

Requires Go 1.27, Node 26 and Docker.

| Command | What it does |
|---|---|
| `make dev` | Go server on :8089, dummy target on :8090, Vite on :5173 with hot reload |
| `make check` | gofmt, go vet, go test, TypeScript, oxlint, Vitest |
| `make build` | `bin/ndswarm` with the UI embedded, and `bin/dummytarget` |
| `make image` | Docker image `ndswarm:dev` |
| `make e2e` | browser smoke test (Playwright) against a fresh compose stack |
| `make bench` | throughput check, fails below 20,000 req/s |
| `make helm` | lint the chart, regenerate and validate `deploy/k8s/ndswarm.yaml` |

Layout: `cmd/` (binaries), `internal/` (Go packages: `api`, `engine`, `runner`, `metrics`,
`logsink`, `tmpl`, `store`, ...), `web/` (React UI), `deploy/` (Docker, compose, Helm),
`e2e/` (Playwright), `tools/bench/`.
