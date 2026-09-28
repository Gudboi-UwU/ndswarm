import type { RunKey } from '@/api/types'

export function keyLabel(k: RunKey | undefined): string {
  if (!k) return 'Unknown endpoint'
  let s = k.flow
  if (k.step !== k.flow) s += ` / ${k.step}`
  if (k.variant) s += ` [${k.variant}]`
  return s
}

export const categoryLabel: Record<string, string> = {
  http_4xx: 'HTTP 4xx',
  http_5xx: 'HTTP 5xx',
  timeout: 'Timeout',
  connection: 'Connection failed',
  dns: 'DNS lookup failed',
  tls: 'TLS failed',
  template: 'Template error',
}

export interface LogFilters {
  key: string // '' = all
  category: string // '', 'ok', 'error' or a category
  reason: string
  minMs: string
  from: string // seconds since start
  to: string
}

export const emptyFilters: LogFilters = { key: '', category: '', reason: '', minMs: '', from: '', to: '' }
