import { CopyIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import type { BodyType, Step, Variant } from '@/api/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { hasErrorUnder, newVariant, uid, useBuilder } from './draft'
import { FieldsEditor } from './fields-editor'
import { RawEditor } from './raw-editor'

type Body = Step['body']

const bodyTypes: { value: BodyType; label: string }[] = [
  { value: 'none', label: 'No body' },
  { value: 'json', label: 'JSON' },
  { value: 'form', label: 'Form (urlencoded)' },
  { value: 'multipart', label: 'Multipart form' },
  { value: 'raw', label: 'Raw text' },
]

/** Body type, then one or more variants; each run request uses one variant. */
export function BodyEditor({ body, onChange, path, selected, onSelect }: { body: Body; onChange: (b: Body) => void; path: string; selected: number; onSelect: (i: number) => void }) {
  const { errors, readOnly } = useBuilder()
  const set = (patch: Partial<Body>) => onChange({ ...body, ...patch })
  const variants = body.variants
  const vi = Math.min(selected, Math.max(variants.length - 1, 0))
  const v = variants[vi]
  const setVariant = (patch: Partial<Variant>) => set({ variants: variants.map((x, i) => (i === vi ? { ...x, ...patch } : x)) })

  const setType = (type: BodyType) => {
    const next: Body = { ...body, type }
    if (type !== 'none' && variants.length === 0) next.variants = [newVariant(1)]
    // Raw text is only valid for JSON and raw bodies; form bodies are flat fields.
    next.variants = next.variants.map((x) => ({
      ...x,
      mode: type === 'raw' ? 'raw' : type === 'form' || type === 'multipart' ? 'fields' : x.mode,
      fields: type === 'form' || type === 'multipart' ? x.fields.filter((f) => f.type !== 'object' && f.type !== 'array') : x.fields,
    }))
    onChange(next)
  }
  const addVariant = (from?: Variant) => {
    const nv = from ? { ...structuredClone(from), id: uid(), name: `${from.name} copy` } : { ...newVariant(variants.length + 1), mode: body.type === 'raw' ? ('raw' as const) : ('fields' as const) }
    set({ variants: [...variants, nv] })
    onSelect(variants.length)
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-2">
          <Label htmlFor={`${path}-type`}>Body</Label>
          <Select value={body.type} onValueChange={(t) => setType(t as BodyType)}>
            <SelectTrigger id={`${path}-type`} className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {bodyTypes.map((t) => (
                <SelectItem key={t.value} value={t.value}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {body.type === 'raw' && (
          <div className="grid gap-2">
            <Label htmlFor={`${path}-ct`}>Content-Type</Label>
            <Input id={`${path}-ct`} className="w-56 font-mono text-[13px]" placeholder="text/plain" value={body.contentType} onChange={(e) => set({ contentType: e.target.value })} />
          </div>
        )}
        {variants.length > 1 && (
          <div className="grid gap-2">
            <Label htmlFor={`${path}-pick`}>Use variants</Label>
            <Select value={body.variantPick} onValueChange={(p) => set({ variantPick: p as Body['variantPick'] })}>
              <SelectTrigger id={`${path}-pick`} className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="roundRobin">In turn</SelectItem>
                <SelectItem value="random">At random</SelectItem>
                <SelectItem value="weighted">By weight</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
      {errors.get(`${path}.variants`) && <p className="text-sm text-destructive">{errors.get(`${path}.variants`)}</p>}

      {body.type !== 'none' && v && (
        <div className="rounded-lg border">
          <div className="flex flex-wrap items-center gap-1 border-b p-2" role="tablist" aria-label="Body variants">
            {variants.map((x, i) => (
              <button
                key={x.id}
                type="button"
                role="tab"
                aria-selected={i === vi}
                onClick={() => onSelect(i)}
                className={cn(
                  'rounded-md px-2.5 py-1 text-sm transition-colors',
                  i === vi ? 'bg-muted font-medium' : 'text-muted-foreground hover:text-foreground',
                  !x.enabled && 'line-through',
                  hasErrorUnder(errors, `${path}.variants.${i}`) && 'text-destructive',
                )}
              >
                {x.name || 'unnamed'}
              </button>
            ))}
            {!readOnly && variants.length < 20 && (
              <Button type="button" variant="ghost" size="sm" onClick={() => addVariant()}>
                <PlusIcon />
                Variant
              </Button>
            )}
          </div>
          <div className="grid gap-4 p-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="grid gap-2">
                <Label htmlFor={`${path}-vname`}>Variant name</Label>
                <Input id={`${path}-vname`} className="w-48" value={v.name} aria-invalid={errors.get(`${path}.variants.${vi}.name`) ? true : undefined} onChange={(e) => setVariant({ name: e.target.value })} />
              </div>
              {body.variantPick === 'weighted' && variants.length > 1 && (
                <div className="grid gap-2">
                  <Label htmlFor={`${path}-vweight`}>Weight</Label>
                  <Input id={`${path}-vweight`} type="number" min={0} className="w-24 font-mono" value={v.weight} onChange={(e) => setVariant({ weight: Number(e.target.value) })} />
                </div>
              )}
              {body.type === 'json' && (
                <div className="grid gap-2">
                  <span className="text-sm font-medium">Edit as</span>
                  <div className="flex rounded-md border p-0.5" role="radiogroup" aria-label="Edit as">
                    {(['fields', 'raw'] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        role="radio"
                        aria-checked={v.mode === m}
                        onClick={() => setVariant({ mode: m })}
                        className={cn('rounded px-2.5 py-1 text-sm', v.mode === m ? 'bg-muted font-medium' : 'text-muted-foreground')}
                      >
                        {m === 'fields' ? 'Fields' : 'Raw JSON'}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <label className="flex items-center gap-2 pb-1.5 text-sm">
                <Switch checked={v.enabled} onCheckedChange={(enabled) => setVariant({ enabled })} />
                Enabled
              </label>
              {!readOnly && (
                <div className="ml-auto flex gap-1">
                  <Button type="button" variant="ghost" size="icon-sm" aria-label="Duplicate variant" onClick={() => addVariant(v)}>
                    <CopyIcon />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Delete variant"
                    disabled={variants.length === 1}
                    onClick={() => {
                      set({ variants: variants.filter((_, i) => i !== vi) })
                      onSelect(Math.max(0, vi - 1))
                    }}
                  >
                    <Trash2Icon />
                  </Button>
                </div>
              )}
            </div>
            {v.mode === 'raw' ? (
              <>
                <RawEditor key={v.id} label={`Raw body of ${v.name}`} value={v.raw} onChange={(raw) => setVariant({ raw })} isJson={body.type === 'json'} />
                {errors.get(`${path}.variants.${vi}.raw`) && <p className="text-sm text-destructive">{errors.get(`${path}.variants.${vi}.raw`)}</p>}
                {body.type === 'json' && (
                  <p className="text-sm text-muted-foreground">
                    Type <code className="font-mono">{'{{'}</code> for generators. Wrap text in <code className="font-mono">{'{{q (name)}}'}</code> so quotes stay valid JSON.
                  </p>
                )}
              </>
            ) : (
              <FieldsEditor key={v.id} fields={v.fields} onChange={(fields) => setVariant({ fields })} path={`${path}.variants.${vi}.fields`} nested={body.type === 'json'} />
            )}
          </div>
        </div>
      )}
    </div>
  )
}
