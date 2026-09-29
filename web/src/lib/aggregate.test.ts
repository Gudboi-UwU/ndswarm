import { expect, test } from 'vitest'
import { aggregate } from './aggregate'

test('aggregate modes', () => {
  const v = [0.6, 0.6, 51.7, 0.6, 0.6, 0.6]
  expect(aggregate(v, 'sum')).toBeCloseTo(54.7)
  expect(aggregate(v, 'mean')).toBeCloseTo(9.1167, 3)
  expect(aggregate(v, 'median')).toBe(0.6)
  expect(aggregate([3, 1, 2, 10], 'median')).toBe(2.5)
  expect(aggregate(v, 'max')).toBe(51.7)
  expect(aggregate(v, 'min')).toBe(0.6)
  expect(aggregate([], 'mean')).toBe(0)
})
