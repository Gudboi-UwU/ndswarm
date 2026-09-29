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

export const statusText: Record<string, string> = {
  '200': 'OK', '201': 'Created', '202': 'Accepted', '204': 'No Content',
  '301': 'Moved Permanently', '302': 'Found (redirect)', '304': 'Not Modified',
  '400': 'Bad Request: the server rejected the request as invalid', '401': 'Unauthorized: login or token missing or wrong',
  '403': 'Forbidden: not allowed', '404': 'Not Found', '405': 'Method Not Allowed', '408': 'Request Timeout',
  '409': 'Conflict', '422': 'Unprocessable: the data was rejected', '429': 'Too Many Requests: the server is rate limiting',
  '500': 'Internal Server Error: the server crashed on this request', '502': 'Bad Gateway: a proxy could not reach the app',
  '503': 'Service Unavailable: the server is overloaded or down', '504': 'Gateway Timeout: the app answered too slowly for the proxy',
}

export const categoryHelp: Record<string, string> = {
  http_4xx: 'The server answered with a 4xx status: it rejected the request (bad data, missing login, not found, rate limited).',
  http_5xx: 'The server answered with a 5xx status: it failed while handling the request, or a proxy could not reach it.',
  timeout: 'No complete answer within the request\'s time limit (More options > Give up after).',
  connection: 'The connection could not be made or was cut: the server is down, refused it, or is not allowed in Settings.',
  dns: 'The server name could not be found. Check the address.',
  tls: 'The secure (HTTPS) connection failed, for example because of an invalid certificate.',
  template: 'The request could not be built, for example a generated value had the wrong type.',
}
