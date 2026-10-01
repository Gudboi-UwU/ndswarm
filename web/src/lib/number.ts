/**
 * What a number input's typed text commits to: the parsed number, or null while it does not parse
 * yet (empty, "-", a bare ".", mid-typing a negative or decimal). Used by NumberInput so that
 * clearing a field does not snap it to 0.
 */
export function parseDraft(text: string): number | null {
  const n = Number(text)
  return text.trim() !== '' && Number.isFinite(n) ? n : null
}
