import { expect, test } from 'vitest'
import { parseDraft } from './number'

// Regression check for the bug NumberInput fixes: clearing a number field used to snap it to
// 0 (because onChange ran every keystroke through Number()), so typing "5" right after gave "05".
// parseDraft is what decides whether a keystroke commits: it must say "not yet" for empty text,
// not "0".
test('parseDraft does not treat an empty or partial draft as 0', () => {
  expect(parseDraft('')).toBeNull()
  expect(parseDraft('  ')).toBeNull()
  expect(parseDraft('-')).toBeNull()
  expect(parseDraft('.')).toBeNull()
  expect(parseDraft('abc')).toBeNull()
})

test('parseDraft commits as soon as the text is a real number', () => {
  expect(parseDraft('0')).toBe(0)
  expect(parseDraft('5')).toBe(5)
  expect(parseDraft('-3')).toBe(-3)
  expect(parseDraft('2.5')).toBe(2.5)
  expect(parseDraft(' 7 ')).toBe(7)
})
