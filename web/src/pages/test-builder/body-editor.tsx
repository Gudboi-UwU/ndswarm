import { CopyIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import type { BodyType, Step, Variant } from '@/api/types'
import { NumberInput } from '@/components/number-input'
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
  { value: 'none', label: 'None' },
  { value: 'json', label: 'JSON' },
  { value: 'form', label: 'Form' },
  { value: 'multipart', label: 'Multipart' },
  { value: 'raw', label: 'Text' },
]

/** Segmented control: every option visible, one click to switch. */
function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  const { readOnly } = useBuilder()
  return (
    <div className="flex w-fit rounded-md border p-0.5" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          disabled={readOnly}
          onClick={() => onChange(o.value)}
          className={cn('rounded px-3 py-1 text-sm', value === o.value ? 'bg-muted font-medium' : 'text-muted-foreground hover:text-foreground')}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/**
 * Body type first. A body has one variation by default; more variations (different bodies
 * sent in turn, at random or by weight) only appear once someone adds one.
 */
export function BodyEditor({ body, onChange, path, selected, onSelect }: { body: Body; onChange: (b: Body) => void; path: string; selected: number; onSelect: (i: number) => void }) {
  const { errors, readOnly } = useBuilder()
  const set = (patch: Partial<Body>) => onChange({ ...body, ...patch })
  const variants = body.variants
  const vi = Math.min(selected, Math.max(variants.length - 1, 0))
  const v = variants[vi]
  const many = variants.length > 1
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
    const nv = from
      ? { ...structuredClone(from), id: uid(), name: `${from.name} copy` }
      : { ...newVariant(variants.length + 1), mode: body.type === 'raw' ? ('raw' as const) : ('fields' as const) }
    set({ variants: [...variants, nv] })
    onSelect(variants.length)
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented label="Body type" value={body.type} options={bodyTypes} onChange={setType} />
        {body.type === 'json' && v && (
          <Segmented
            label="Edit as"
            value={v.mode}
            options={[
              { value: 'fields', label: 'Fields' },
              { value: 'raw', label: 'Raw JSON' },
            ]}
            onChange={(mode) => setVariant({ mode })}
          />
        )}
        {body.type === 'raw' && (
          <Input aria-label="Content-Type" className="w-56 font-mono text-[13px]" placeholder="Content-Type: text/plain" value={body.contentType} onChange={(e) => set({ contentType: e.target.value })} />
        )}
      </div>
      {body.type === 'none' && <p className="text-sm text-muted-foreground">Nothing is sent in the body. Typical for GET requests.</p>}
      {errors.get(`${path}.variants`) && <p className="text-sm text-destructive">{errors.get(`${path}.variants`)}</p>}

      {body.type !== 'none' && v && (
        <div className="grid gap-4">
          {many && (
            <div className="grid gap-3 rounded-md bg-muted/40 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">Variations</span>
                <div className="flex flex-wrap gap-1" role="tablist" aria-label="Body variations">
                  {variants.map((x, i) => (
                    <button
                      key={x.id}
                      type="button"
                      role="tab"
                      aria-selected={i === vi}
                      onClick={() => onSelect(i)}
                      className={cn(
                        'rounded-md px-2.5 py-1 text-sm',
                        i === vi ? 'bg-background font-medium shadow-xs' : 'text-muted-foreground hover:text-foreground',
                        !x.enabled && 'line-through',
                        hasErrorUnder(errors, `${path}.variants.${i}`) && 'text-destructive',
                      )}
                    >
                      {x.name || 'unnamed'}
                    </button>
                  ))}
                </div>
                <div className="ml-auto flex items-center gap-2">
                  <Label htmlFor={`${path}-pick`} className="text-sm font-normal text-muted-foreground">
                    Send
                  </Label>
                  <Select value={body.variantPick} onValueChange={(p) => set({ variantPick: p as Body['variantPick'] })}>
                    <SelectTrigger id={`${path}-pick`} size="sm" className="w-36">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="roundRobin">in turn</SelectItem>
                      <SelectItem value="random">at random</SelectItem>
                      <SelectItem value="weighted">by weight</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Input aria-label="Variation name" className="w-48" value={v.name} aria-invalid={errors.get(`${path}.variants.${vi}.name`) ? true : undefined} onChange={(e) => setVariant({ name: e.target.value })} />
                {body.variantPick === 'weighted' && (
                  <label className="flex items-center gap-2 text-sm text-muted-foreground">
                    weight
                    <NumberInput
                      aria-label="Variation weight"
                      min={0}
                      className="w-20"
                      value={v.weight}
                      onCommit={(weight) => setVariant({ weight })}
                      onBlur={() => setVariant({ weight: Math.max(0, Math.round(v.weight) || 0) })}
                    />
                  </label>
                )}
                <label className="flex items-center gap-2 text-sm">
                  <Switch checked={v.enabled} disabled={readOnly} onCheckedChange={(enabled) => setVariant({ enabled })} />
                  Used in runs
                </label>
                {!readOnly && (
                  <div className="ml-auto flex gap-1">
                    <Button type="button" variant="ghost" size="icon-sm" aria-label="Duplicate variation" onClick={() => addVariant(v)}>
                      <CopyIcon />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Delete variation"
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
            </div>
          )}

          {v.mode === 'raw' ? (
            <>
              <RawEditor key={v.id} label={`Body of ${v.name}`} value={v.raw} onChange={(raw) => setVariant({ raw })} isJson={body.type === 'json'} />
              {errors.get(`${path}.variants.${vi}.raw`) && <p className="text-sm text-destructive">{errors.get(`${path}.variants.${vi}.raw`)}</p>}
              <p className="text-sm text-muted-foreground">
                Type <code className="font-mono">{'{{'}</code> to insert random data.
                {body.type === 'json' && (
                  <>
                    {' '}
                    Wrap text in <code className="font-mono">{'{{q (name)}}'}</code> so quotes stay valid JSON.
                  </>
                )}
              </p>
            </>
          ) : (
            <FieldsEditor key={v.id} fields={v.fields} onChange={(fields) => setVariant({ fields })} path={`${path}.variants.${vi}.fields`} nested={body.type === 'json'} />
          )}

          {!readOnly && variants.length < 20 && (
            <div className="flex flex-wrap items-center gap-2 border-t pt-3">
              <Button type="button" variant="ghost" size="sm" onClick={() => addVariant(many ? undefined : v)}>
                <PlusIcon />
                Add a body variation
              </Button>
              {!many && <span className="text-sm text-muted-foreground">Send different bodies to cover more cases, for example small and large orders.</span>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
