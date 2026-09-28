import { PlusIcon, XIcon } from 'lucide-react'
import type { KV } from '@/api/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { useBuilder } from './draft'
import { TemplateInput } from './template-input'

/** Rows of name + template value, for query parameters and headers. */
export function KVEditor({ items, onChange, path, keyLabel }: { items: KV[]; onChange: (items: KV[]) => void; path: string; keyLabel: string }) {
  const { errors, readOnly } = useBuilder()
  const update = (i: number, patch: Partial<KV>) => onChange(items.map((it, j) => (j === i ? { ...it, ...patch } : it)))
  return (
    <div className="grid gap-2">
      {items.map((it, i) => {
        const keyErr = errors.get(`${path}.${i}.key`)
        return (
          <div key={i} className="grid grid-cols-[auto_minmax(0,1fr)_minmax(0,1.6fr)_auto] items-start gap-2">
            <Switch className="mt-2" aria-label={`Send ${it.key || keyLabel}`} checked={it.enabled} onCheckedChange={(enabled) => update(i, { enabled })} />
            <div>
              <Input
                aria-label={`${keyLabel} ${i + 1}`}
                placeholder={keyLabel}
                value={it.key}
                aria-invalid={keyErr ? true : undefined}
                className="font-mono text-[13px]"
                onChange={(e) => update(i, { key: e.target.value })}
              />
              {keyErr && <p className="mt-1 text-sm text-destructive">{keyErr}</p>}
            </div>
            <TemplateInput aria-label={`Value of ${it.key || `${keyLabel} ${i + 1}`}`} placeholder="Value" value={it.value} onChange={(value) => update(i, { value })} error={errors.get(`${path}.${i}.value`)} />
            <Button type="button" variant="ghost" size="icon-sm" className="mt-0.5" aria-label={`Remove ${it.key || 'row'}`} onClick={() => onChange(items.filter((_, j) => j !== i))}>
              <XIcon />
            </Button>
          </div>
        )
      })}
      {!readOnly && (
        <div>
          <Button type="button" variant="outline" size="sm" onClick={() => onChange([...items, { key: '', value: '', enabled: true }])}>
            <PlusIcon />
            Add {keyLabel.toLowerCase()}
          </Button>
        </div>
      )}
    </div>
  )
}
