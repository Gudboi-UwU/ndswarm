# ndswarm: notes for Claude sessions

Load-testing app: Go backend (chi, `internal/`, binary in `cmd/ndswarm`) with an embedded React 19 SPA (`web/`).
The owner speaks Indonesian; reply in Indonesian, keep code, UI text, comments and commits in English.

## Rules
- Work on branch `dev`. Push to `dev` only after `make check` and `make e2e` pass locally.
- CI channels (`.github/workflows/ci.yml`): green push to `dev` tags `vX.Y.Z-dev.N` + image `:dev`;
  `staging` tags `vX.Y.Z-rc.N` + `:staging` + pre-release; `main` tags `vX.Y.Z` + `:latest` + full release.
- Promote `dev -> staging -> main` only when a feature is finished and worth a version.
  Push explicit SHAs (`git push origin <sha>:staging`) and wait for each stage's CI before the next,
  so a newer commit does not ride along with a release in progress.
- Commits: Conventional Commits in English. No `Co-Authored-By` trailer, also for sub-agents.
- Release commit pattern: `chore: release X.Y.Z` (bumps `deploy/helm/ndswarm/Chart.yaml` and the image tag in `deploy/k8s/ndswarm.yaml`).

## Style
- Go: stdlib first, gofmt, short doc comments, one table-style test per package (`httptest`, no frameworks).
  API errors via `writeError` in `internal/api/router.go` (`{"error":{"code","message","details"}}`). Logs: `log/slog` JSON.
- Env vars prefixed `NDSWARM_`. Migrations numbered (last: 006 `tests.folder`).
- TS: strict, single quotes, no semicolons, oxlint. Shared number input: `web/src/components/number-input.tsx`.
- Check UI at 1440 px and 390 px, light and dark.

## State (2026-10-02)
- Latest release v0.7.0 on main = staging = dev (a00b83a): template validation before send/run
  (`internal/tmpl/check.go`, `internal/engine/check.go`, `POST /tests/check`), folders collapsed by default,
  Move to folder as a radio tree.
- Earlier: import/export (native + Postman v2.0/2.1), pass/fail rules with verdict, test folders,
  500 requests per test.

## Next
1. Multi-step flows + extract + assertions ("log in, take the token, use it"). Big feature, start in a fresh session.
   Engine already has `tmpl.Ctx.Vars` per VU and `planFlow.steps`; model has `Step` but no Extract/Assert;
   UI needs ordered steps (a Flows tab or steps inside a request list). This also makes imported
   Postman collections that set variables in scripts actually runnable.
2. Stop a run early when a pass/fail rule is already broken.
3. Quick wins: cURL import, compare two runs, HTML report.
4. Open UX note: red "requests failed" banner can show next to a green Passed badge (by design, wording could be clearer).

Update the State and Next sections when work lands.
