import type { ComponentProps } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type Props = ComponentProps<typeof Input> & { id: string; label: string; error?: string; hint?: string }

/** Label above, input, then the server's validation message (or a hint) below. */
export function FormField({ id, label, error, hint, ...input }: Props) {
  const describedBy = error || hint ? `${id}-desc` : undefined
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} aria-invalid={error ? true : undefined} aria-describedby={describedBy} {...input} />
      {(error || hint) && (
        <p id={describedBy} className={error ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}>
          {error ?? hint}
        </p>
      )}
    </div>
  )
}
