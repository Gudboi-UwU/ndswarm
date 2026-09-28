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
