import { expect, test } from 'vitest'
import { formatMetric } from './thresholds'

test('formatMetric trims trailing zeros', () => {
  expect(formatMetric('avg_ms', 200)).toBe('200 ms')
  expect(formatMetric('avg_ms', 1.5)).toBe('1.5 ms')
})

test('formatMetric keeps small values readable', () => {
  expect(formatMetric('avg_ms', 0.04)).toBe('0.04 ms')
  expect(formatMetric('failed_pct', 0.001)).toBe('0.001%')
  expect(formatMetric('rps', 0.5)).toBe('0.5')
})

test('formatMetric shows zero as 0', () => {
  expect(formatMetric('avg_ms', 0)).toBe('0 ms')
  expect(formatMetric('failed_pct', 0)).toBe('0%')
})
