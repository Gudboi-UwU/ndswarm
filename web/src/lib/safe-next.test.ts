import { expect, test } from 'vitest'
import { safeNext } from './safe-next'

test('safeNext only allows same-origin paths', () => {
  const next = (v: string) => safeNext(new URLSearchParams({ next: v }))
  expect(next('/settings')).toBe('/settings')
  expect(next('/runs/1?tab=logs')).toBe('/runs/1?tab=logs')
  expect(next('//evil.com')).toBe('/')
  expect(next('/\\evil.com')).toBe('/')
  expect(next('https://evil.com')).toBe('/')
  expect(safeNext(new URLSearchParams())).toBe('/')
})
