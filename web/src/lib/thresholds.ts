// Plain-English labels for pass/fail rules (test builder) and their results (run page).
import type { Threshold, ThresholdMetric, ThresholdOp, ThresholdResult } from '@/api/types'

export const METRICS: { value: ThresholdMetric; label: string; subject: string; verb: string; unit: string; digits: number }[] = [
  { value: 'failed_pct', label: 'Failed requests (%)', subject: 'failed requests', verb: 'are', unit: '%', digits: 2 },
  { value: 'avg_ms', label: 'Average response time (ms)', subject: 'the average response time', verb: 'is', unit: ' ms', digits: 1 },
  { value: 'p95_ms', label: '95% of requests within (ms)', subject: 'the response time for 95% of requests', verb: 'is', unit: ' ms', digits: 1 },
  { value: 'p99_ms', label: '99% of requests within (ms)', subject: 'the response time for 99% of requests', verb: 'is', unit: ' ms', digits: 1 },
  { value: 'max_ms', label: 'Slowest request (ms)', subject: 'the slowest request', verb: 'is', unit: ' ms', digits: 1 },
  { value: 'rps', label: 'Requests per second', subject: 'requests per second', verb: 'are', unit: '', digits: 0 },
]

export const OPS: { value: ThresholdOp; label: string }[] = [
  { value: '<', label: 'below' },
  { value: '<=', label: 'at most' },
  { value: '>', label: 'above' },
  { value: '>=', label: 'at least' },
]

function metricOf(m: ThresholdMetric) {
  return METRICS.find((x) => x.value === m) ?? METRICS[0]
}

function cap(s: string): string {
  return s[0].toUpperCase() + s.slice(1)
}

/** Trims trailing zeros. Values >= 1 keep up to `maxDigits` decimals; smaller values keep 3 significant digits. */
function formatValue(v: number, maxDigits: number): string {
  if (v === 0) return '0'
  const digits = Math.abs(v) >= 1 ? maxDigits : Math.max(0, 3 - Math.ceil(Math.log10(Math.abs(v))))
  return v.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: 0 })
}

export function formatMetric(m: ThresholdMetric, v: number): string {
  const c = metricOf(m)
  return `${formatValue(v, c.digits)}${c.unit}`
}

// A rule passes when the metric satisfies op+value (e.g. op "<=" passes when actual <= value),
// so the sentence states that requirement rather than a "fail if" condition, which would say
// the opposite of what the rule checks.
/** "Failed requests are at most 1%, or the run fails." */
export function ruleSentence(t: Pick<Threshold, 'metric' | 'op' | 'value'>): string {
  const m = metricOf(t.metric)
  const op = OPS.find((x) => x.value === t.op) ?? OPS[0]
  return `${cap(m.subject)} ${m.verb} ${op.label} ${formatMetric(t.metric, t.value)}, or the run fails.`
}

/** "Failed requests are at most 1%: actual 2.3%." */
export function resultSentence(r: ThresholdResult): string {
  const m = metricOf(r.metric)
  const op = OPS.find((x) => x.value === r.op) ?? OPS[0]
  return `${cap(m.subject)} ${m.verb} ${op.label} ${formatMetric(r.metric, r.value)}: actual ${formatMetric(r.metric, r.actual)}.`
}
