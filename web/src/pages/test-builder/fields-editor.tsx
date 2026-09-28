import { CornerDownRightIcon, PlusIcon, XIcon } from 'lucide-react'
import type { Field, FieldType } from '@/api/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { newField, useBuilder } from './draft'
import { TemplateInput } from './template-input'

const TYPES: FieldType[] = ['string', 'integer', 'number', 'boolean', 'object', 'array', 'null']
const FLAT: FieldType[] = ['string', 'integer', 'number', 'boolean', 'null']
const typeLabel: Record<FieldType, string> = {
  string: 'text',
  integer: 'whole number',
  number: 'decimal number',
  boolean: 'true / false',
  object: 'object',
  array: 'list',
  null: 'null',
}

/** Typed body fields. Nested objects and arrays only for JSON bodies. */
export function FieldsEditor({ fields, onChange, path, nested }: { fields: Field[]; onChange: (f: Field[]) => void; path: string; nested: boolean }) {
  const { readOnly } = useBuilder()
  return (
    <div className="grid gap-2">
      {fields.length === 0 ? (
        <p className="text-sm text-muted-foreground">No fields yet. The body is {nested ? 'an empty JSON object {}' : 'empty'}.</p>
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)_9rem_minmax(0,1.6fr)_auto] gap-2 text-xs text-muted-foreground">
          <span>Field name</span>
          <span>Type</span>
          <span>Value (fixed, or generated with the wand)</span>
          <span className="w-16" aria-hidden="true" />
        </div>
      )}
      <FieldRows fields={fields} onChange={onChange} path={path} depth={0} nested={nested} />
      {!readOnly && (
        <div>
          <Button type="button" variant="outline" size="sm" onClick={() => onChange([...fields, newField()])}>
            <PlusIcon />
            Add field
          </Button>
        </div>
      )}
    </div>
  )
}

function FieldRows({ fields, onChange, path, depth, nested, arrayItem }: { fields: Field[]; onChange: (f: Field[]) => void; path: string; depth: number; nested: boolean; arrayItem?: boolean }) {
  const update = (i: number, f: Field) => onChange(fields.map((x, j) => (j === i ? f : x)))
  return fields.map((f, i) => (
    <FieldRow
      key={i}
      field={f}
      path={`${path}.${i}`}
      depth={depth}
      nested={nested}
      arrayItem={arrayItem}
      onChange={(nf) => update(i, nf)}
      onRemove={arrayItem ? undefined : () => onChange(fields.filter((_, j) => j !== i))}
    />
  ))
}

function FieldRow({
  field: f,
  path,
  depth,
  nested,
  arrayItem,
  onChange,
  onRemove,
}: {
  field: Field
  path: string
  depth: number
  nested: boolean
  arrayItem?: boolean
  onChange: (f: Field) => void
  onRemove?: () => void
}) {
  const { errors, readOnly } = useBuilder()
  const err = (k: string) => errors.get(`${path}.${k}`)
  const setType = (type: FieldType) => {
    const next: Field = { ...f, type }
    if (type === 'object' && !f.children.length) next.children = []
    if (type === 'array') {
      next.children = [f.children[0] ?? newField()]
      next.arrayLen = f.arrayLen ?? { min: 1, max: 3 }
    }
    onChange(next)
  }
  const enabled = f.enabled !== false
  const keyErr = err('key')
  const typeErr = err('type') ?? err('children') ?? err('arrayLen')

  return (
    <>
      <div className="grid grid-cols-[minmax(0,1fr)_9rem_minmax(0,1.6fr)_auto] items-start gap-2" style={{ paddingLeft: depth * 20 }}>
        <div className="flex items-start gap-1.5">
          {depth > 0 && <CornerDownRightIcon className="mt-2.5 size-3.5 shrink-0 text-muted-foreground" />}
          {arrayItem ? (
            <span className="mt-2 text-sm text-muted-foreground">each list item</span>
          ) : (
            <div className="min-w-0 flex-1">
              <Input
                aria-label={`Key at ${path}`}
                placeholder="key"
                value={f.key}
                aria-invalid={keyErr ? true : undefined}
                className="font-mono text-[13px]"
                onChange={(e) => onChange({ ...f, key: e.target.value })}
              />
              {keyErr && <p className="mt-1 text-sm text-destructive">{keyErr}</p>}
            </div>
          )}
        </div>
        <div>
          <Select value={f.type} onValueChange={(t) => setType(t as FieldType)}>
            <SelectTrigger className="w-full" aria-label={`Type of ${f.key || 'item'}`} aria-invalid={typeErr ? true : undefined}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(nested ? TYPES : FLAT).map((t) => (
                <SelectItem key={t} value={t}>
                  {typeLabel[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          {f.type === 'object' ? (
            <p className="mt-2 text-sm text-muted-foreground">{f.children.length} field{f.children.length === 1 ? '' : 's'} inside, below</p>
          ) : f.type === 'array' ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Input
                aria-label={`Minimum items of ${f.key}`}
                type="number"
                min={0}
                className="w-20 font-mono"
                value={f.arrayLen?.min ?? 0}
                onChange={(e) => onChange({ ...f, arrayLen: { min: Number(e.target.value), max: f.arrayLen?.max ?? 0 } })}
              />
              to
              <Input
                aria-label={`Maximum items of ${f.key}`}
                type="number"
                min={0}
                className="w-20 font-mono"
                value={f.arrayLen?.max ?? 0}
                onChange={(e) => onChange({ ...f, arrayLen: { min: f.arrayLen?.min ?? 0, max: Number(e.target.value) } })}
              />
              items
            </div>
          ) : f.type === 'null' ? (
            <p className="mt-2 font-mono text-sm text-muted-foreground">null</p>
          ) : (
            <TemplateInput
              aria-label={`Value of ${f.key || 'item'}`}
              placeholder={f.type === 'boolean' ? 'true' : f.type === 'string' ? 'text or {{generator}}' : '0'}
              value={f.value}
              type={f.type}
              onChange={(value) => onChange({ ...f, value })}
              error={err('value')}
            />
          )}
          {typeErr && <p className="mt-1 text-sm text-destructive">{typeErr}</p>}
        </div>
        <div className="flex items-center gap-1 pt-1">
          {!arrayItem && (
            <Switch aria-label={`Include ${f.key || 'field'}`} checked={enabled} onCheckedChange={(on) => onChange({ ...f, enabled: on ? undefined : false })} />
          )}
          {!readOnly && f.type === 'object' && (
            <Button type="button" variant="ghost" size="icon-sm" aria-label={`Add field inside ${f.key || 'object'}`} onClick={() => onChange({ ...f, children: [...f.children, newField()] })}>
              <PlusIcon />
            </Button>
          )}
          {onRemove && (
            <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove ${f.key || 'field'}`} onClick={onRemove}>
              <XIcon />
            </Button>
          )}
        </div>
      </div>
      {f.type === 'object' && <FieldRows fields={f.children} onChange={(children) => onChange({ ...f, children })} path={`${path}.children`} depth={depth + 1} nested={nested} />}
      {f.type === 'array' && f.children[0] && (
        <FieldRows fields={f.children.slice(0, 1)} onChange={(children) => onChange({ ...f, children })} path={`${path}.children`} depth={depth + 1} nested={nested} arrayItem />
      )}
    </>
  )
}
