// Mirrors internal/auth and internal/api. Go is the source of truth for validation.

export type Role = 'admin' | 'editor' | 'viewer'
export type GuestMode = 'off' | 'view' | 'run'

export interface User {
  id: number
  username: string
  role: Role
  createdAt: number
}

export interface Me {
  user: User | null
  guestMode: GuestMode
  setupRequired: boolean
  can: { view: boolean; run: boolean; edit: boolean; admin: boolean }
}

export interface Settings {
  guestMode: GuestMode
  retentionDays: number
  targetAllowlist: string[]
  allowLinkLocal: boolean
}

export interface SystemInfo {
  version: string
  goVersion: string
  cpus: number
  goroutines: number
  memMB: number
  uptimeSec: number
}

export interface FieldError {
  path: string
  message: string
}

// ---- projects (mirrors internal/model)

export interface Project {
  id: number
  name: string
  description: string
  createdAt: number
  testCount: number
}

export interface EnvVar {
  key: string
  value: string
  secret: boolean
}

export type AuthType = 'none' | 'bearer' | 'basic' | 'apiKey'

export interface Environment {
  id: number
  projectId: number
  name: string
  baseUrl: string
  variables: EnvVar[]
  headers: EnvVar[]
  auth: { type: AuthType; token?: string; username?: string; password?: string; header?: string; value?: string }
}

/** Secret values come back as this; sending it unchanged keeps the stored value. */
export const MASKED = '••••••••'

export interface TestSummary {
  id: number
  name: string
  description: string
  environmentId: number | null
  endpoints: number
  updatedAt: number
}

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS'
export type BodyType = 'none' | 'json' | 'form' | 'multipart' | 'raw'
export type FieldType = 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array' | 'null'

export interface KV {
  key: string
  value: string
  enabled: boolean
}

export interface Field {
  key: string
  type: FieldType
  value: string
  children: Field[]
  arrayLen?: { min: number; max: number }
  enabled?: boolean
}

export interface Variant {
  id: string
  name: string
  weight: number
  enabled: boolean
  mode: 'fields' | 'raw'
  fields: Field[]
  raw: string
}

export interface Step {
  id: string
  name: string
  enabled: boolean
  method: Method
  url: string
  query: KV[]
  headers: KV[]
  body: { type: BodyType; variantPick: 'roundRobin' | 'random' | 'weighted'; contentType: string; variants: Variant[] }
  timeoutMs: number
  followRedirects: boolean
}

export interface Flow {
  id: string
  name: string
  enabled: boolean
  weight: number
  steps: Step[]
}

export interface Test {
  id: number
  projectId: number
  name: string
  description: string
  environmentId: number | null
  flows: Flow[]
  load: Load
  settings: HttpSettings
  updatedAt: number
}

export interface Generator {
  id: string
  label: string
  group: string
  output: 'string' | 'integer' | 'number' | 'boolean'
  params: { name: string; type: string; default?: unknown }[] | null
  snippet: string
}

export interface RenderResult {
  samples: string[]
  error: string | null
}

export interface Timing {
  dns: number
  connect: number
  tls: number
  ttfb: number
  download: number
  total: number
  reused: boolean
}

export interface TryResult {
  request?: { method: string; url: string; headers: Record<string, string[]>; body: string; variant?: string }
  response?: { status: number; statusText: string; headers: Record<string, string[]>; body: string; size: number; truncated: boolean }
  timing?: Timing
  error: { category: string; message: string } | null
}

// ---- runs (mirrors internal/runner and internal/metrics)

export interface Stage {
  durationSec: number
  target: number
}

export interface Load {
  model: 'closed'
  stages: Stage[]
  gracefulStopSec: number
  maxVUs: number
}

export interface HttpSettings {
  keepAlive: boolean
  http2: boolean
  insecureTLS: boolean
  userAgent: string
  logSamplePct: number
  captureBodies: boolean
}

export interface Stats {
  count: number
  ok: number
  err: number
  avg: number
  min: number
  max: number
  p50: number
  p90: number
  p95: number
  p99: number
  rps: number
  bytesIn: number
  bytesOut: number
}

export interface KeyStats {
  keyId: number
  total: Stats
  second: Stats
}

export interface RunKey {
  keyId: number
  flow: string
  step: string
  variant: string
  method: string
  url: string
}

export type RunStatus = 'running' | 'stopping' | 'finished' | 'failed' | 'aborted'

export interface Tick {
  type: 'run.tick'
  runId: number
  elapsedSec: number
  status: RunStatus
  vus: number
  targetVus: number
  total: Stats
  recent5s: Stats
  second: Stats
  keys: KeyStats[]
  codes: Record<string, number>
  droppedLogs: number
}

export interface Run {
  id: number
  testId: number | null
  projectId: number | null
  testName: string
  environment: string
  status: RunStatus
  verdict: 'pass' | 'fail' | null
  startedAt: number
  endedAt: number | null
  endReason: string
  createdBy: string
  load: Load
  keys: RunKey[]
  summary: { elapsedSec: number; droppedLogs: number; total: Stats; keys: KeyStats[]; codes: Record<string, number> } | null
  live?: Tick
}

export interface Point {
  t: number
  count: number
  ok: number
  err: number
  avg: number
  p50: number
  p95: number
  p99: number
  vus: number
  bytesIn: number
}

export interface PreflightCheck {
  name: string
  method: string
  url: string
  status: number
  latencyMs: number
  error?: string
  snippet?: string
}

export interface Preflight {
  errors: string[]
  warnings: string[]
  checks: PreflightCheck[]
}

// ---- logs, errors, summary, dashboard (mirrors internal/runner and internal/logsink)

export interface LogRow {
  id: number
  tMs: number
  sec: number
  vu: number
  iter: number
  keyId: number
  status: number
  category: string
  latencyMs: number
  reason: 'error' | 'sample' | 'slowest'
  error: string
}

export interface LogDetail extends LogRow {
  timing: Timing
  request: { method: string; url: string; headers: Record<string, string[]>; body: string; bodySize: number; truncated: boolean } | null
  response: { status: number; headers: Record<string, string[]>; body: string; bodySize: number; truncated: boolean } | null
}

export interface ErrorGroup {
  keyId: number
  category: string
  message: string
  count: number
  exampleLogId: number | null
  firstSec: number
  lastSec: number
}

export interface ErrorsView {
  groups: ErrorGroup[]
  byCategory: Record<string, number>
  droppedLogs: number
}

export interface IntervalRow {
  fromSec: number
  toSec: number
  count: number
  ok: number
  err: number
  rps: number
  avg: number
  p50: number
  p90: number
  p95: number
  p99: number
  max: number
}

export interface StatusRow {
  keyId: number
  code: string
  count: number
}

export interface DashboardStat {
  runs: number
  passed: number
  finished: number
  requests: number
  errors: number
  passRate: number
}

export interface Dashboard {
  active: Run | null
  today: DashboardStat
  week: DashboardStat
  recent: Run[]
}
