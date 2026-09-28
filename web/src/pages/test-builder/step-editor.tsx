import { useState, type ReactNode } from 'react'
import type { ApiError } from '@/api/client'
import type { Flow, Method, Step } from '@/api/types'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { BodyEditor } from './body-editor'
import { METHODS, useBuilder } from './draft'
import { KVEditor } from './kv-editor'
import { TemplateInput } from './template-input'
import { TryPanel } from './try-panel'

/** Editor for one endpoint (a flow with a single step). */
export function EndpointEditor({
  flow,
  index,
  share,
  onChange,
  onTryErrors,
}: {
  flow: Flow
  index: number
  share: number | null
  onChange: (f: Flow) => void
  onTryErrors: (e: ApiError) => void
}) {
  const { errors, environmentId } = useBuilder()
  const [variant, setVariant] = useState(0)
  const step = flow.steps[0]
  const path = `flows.${index}.steps.0`
  const setStep = (patch: Partial<Step>) => {
    const s = { ...step, ...patch }
    onChange({ ...flow, name: s.name, enabled: s.enabled, steps: [s] })
  }
  const nameErr = errors.get(`${path}.name`) ?? errors.get(`flows.${index}.name`)

  return (
    <div className="grid gap-8">
      <div className="grid gap-4">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3">
          <div className="grid gap-2">
            <Label htmlFor="ep-name">Endpoint name</Label>
            <Input id="ep-name" value={step.name} aria-invalid={nameErr ? true : undefined} onChange={(e) => setStep({ name: e.target.value })} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="ep-weight">Weight</Label>
            <div className="flex items-center gap-2">
              <Input
                id="ep-weight"
                type="number"
                min={0}
                className="w-20 font-mono"
                value={flow.weight}
                onChange={(e) => onChange({ ...flow, weight: Math.max(0, Number(e.target.value)) })}
              />
              <span className="w-12 text-sm text-muted-foreground tabular-nums">{share === null ? 'off' : `${share.toFixed(0)}%`}</span>
            </div>
          </div>
        </div>
        {nameErr && <p className="-mt-2 text-sm text-destructive">{nameErr}</p>}
        <div className="grid grid-cols-[7rem_minmax(0,1fr)] items-start gap-2">
          <Select value={step.method} onValueChange={(m) => setStep({ method: m as Method })}>
            <SelectTrigger aria-label="Method" className="w-full font-mono">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {METHODS.map((m) => (
                <SelectItem key={m} value={m} className="font-mono">
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <TemplateInput aria-label="URL" placeholder="/orders/{{int 1 500}}" value={step.url} onChange={(url) => setStep({ url })} error={errors.get(`${path}.url`) ?? errors.get(`${path}.method`)} />
        </div>
        <p className="-mt-2 text-sm text-muted-foreground">A path is joined to the environment's base URL. A full URL is used as is.</p>
      </div>

      <Section title="Query parameters" hint="Values are URL-encoded for you.">
        <KVEditor items={step.query} onChange={(query) => setStep({ query })} path={`${path}.query`} keyLabel="Parameter" />
      </Section>

      <Section title="Headers" hint="Override the environment's default headers with the same name.">
        <KVEditor items={step.headers} onChange={(headers) => setStep({ headers })} path={`${path}.headers`} keyLabel="Header" />
      </Section>

      <BodyEditor body={step.body} onChange={(body) => setStep({ body })} path={`${path}.body`} selected={variant} onSelect={setVariant} />

      <Section title="Options">
        <div className="flex flex-wrap items-end gap-6">
          <div className="grid gap-2">
            <Label htmlFor="ep-timeout">Timeout (ms)</Label>
            <Input
              id="ep-timeout"
              type="number"
              min={1}
              className="w-32 font-mono"
              value={step.timeoutMs}
              aria-invalid={errors.get(`${path}.timeoutMs`) ? true : undefined}
              onChange={(e) => setStep({ timeoutMs: Number(e.target.value) })}
            />
          </div>
          <label className="flex items-center gap-2 pb-1.5 text-sm">
            <Switch checked={step.followRedirects} onCheckedChange={(followRedirects) => setStep({ followRedirects })} />
            Follow redirects
          </label>
        </div>
        {errors.get(`${path}.timeoutMs`) && <p className="text-sm text-destructive">{errors.get(`${path}.timeoutMs`)}</p>}
      </Section>

      <TryPanel step={step} environmentId={environmentId} variant={variant} onValidationError={onTryErrors} />
    </div>
  )
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="grid gap-3">
      <div>
        <h3 className="text-sm font-medium">{title}</h3>
        {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </section>
  )
}
