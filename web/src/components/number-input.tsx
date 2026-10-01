import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { parseDraft } from '@/lib/number'
import { cn } from '@/lib/utils'

/**
 * A number input that keeps whatever you are typing, instead of rounding it through Number() on
 * every keystroke: clearing the field no longer snaps to 0, so typing "5" after clearing "3" gives
 * "5", not "05". The committed number updates as soon as the text parses; leaving the field (or an
 * external change to `value`) resets the text to the last committed value and calls `onBlur`, which
 * callers use to clamp (e.g. round, enforce min/max).
 */
export function NumberInput({
  id,
  'aria-label': ariaLabel,
  className,
  min,
  max,
  step,
  invalid,
  readOnly,
  disabled,
  value,
  onCommit,
  onBlur,
}: {
  id?: string
  'aria-label'?: string
  className?: string
  min?: number
  max?: number
  step?: number
  invalid?: boolean
  readOnly?: boolean
  disabled?: boolean
  value: number
  onCommit: (v: number) => void
  onBlur?: () => void
}) {
  const [state, setState] = useState(() => ({ value, text: String(value) }))
  if (state.value !== value) setState({ value, text: String(value) })
  return (
    <Input
      id={id}
      aria-label={ariaLabel}
      type="number"
      min={min}
      max={max}
      step={step}
      readOnly={readOnly}
      disabled={disabled}
      className={cn('font-mono', className)}
      value={state.text}
      aria-invalid={invalid ? true : undefined}
      onChange={(e) => {
        const text = e.target.value
        setState((s) => ({ ...s, text }))
        const n = parseDraft(text)
        if (n !== null) onCommit(n)
      }}
      onBlur={() => {
        setState({ value, text: String(value) })
        onBlur?.()
      }}
    />
  )
}
