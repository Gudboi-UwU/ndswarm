import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { aggModes, type AggMode } from '@/lib/aggregate'

/** Chooses how a table's total row combines the rows. */
export function AggPicker({ value, onChange, modes = aggModes.map((m) => m.value) }: { value: AggMode; onChange: (m: AggMode) => void; modes?: AggMode[] }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as AggMode)}>
      <SelectTrigger size="sm" aria-label="How the total row combines the rows" className="h-7 w-auto gap-1 font-sans text-xs font-semibold">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {aggModes
          .filter((m) => modes.includes(m.value))
          .map((m) => (
            <SelectItem key={m.value} value={m.value}>
              {m.label}
            </SelectItem>
          ))}
      </SelectContent>
    </Select>
  )
}

/** The explanation of the chosen mode, shown under the table. */
export function AggNote({ value }: { value: AggMode }) {
  const m = aggModes.find((x) => x.value === value)
  return (
    <p className="text-xs text-muted-foreground">
      <span className="font-medium text-foreground">Last row, {m?.label.toLowerCase()}:</span> {m?.help}
    </p>
  )
}
