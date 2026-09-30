// Plain-English labels for pass/fail rules (test builder) and their results (run page).
import type { Threshold, ThresholdMetric, ThresholdOp, ThresholdResult } from '@/api/types'
import { formatNumber } from './format'

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

export function formatMetric(m: ThresholdMetric, v: number): string {
  const c = metricOf(m)
  return `${formatNumber(v, c.digits)}${c.unit}`
}

/** "Fail the run if failed requests are at least 1%." */
export function ruleSentence(t: Pick<Threshold, 'metric' | 'op' | 'value'>): string {
  const m = metricOf(t.metric)
  const op = OPS.find((x) => x.value === t.op) ?? OPS[0]
  return `Fail the run if ${m.subject} ${m.verb} ${op.label} ${formatMetric(t.metric, t.value)}.`
}

/** "Failed requests are at least 1%: actual 2.30%." */
export function resultSentence(r: ThresholdResult): string {
  const m = metricOf(r.metric)
  const op = OPS.find((x) => x.value === r.op) ?? OPS[0]
  return `${m.subject[0].toUpperCase()}${m.subject.slice(1)} ${m.verb} ${op.label} ${formatMetric(r.metric, r.value)}: actual ${formatMetric(r.metric, r.actual)}.`
}
