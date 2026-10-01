import { CircleHelpIcon, SendIcon } from 'lucide-react'
import { useState } from 'react'
import type { ApiError } from '@/api/client'
import type { Flow, Method, Step } from '@/api/types'
import { Disclosure } from '@/components/disclosure'
import { NumberInput } from '@/components/number-input'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { BodyEditor } from './body-editor'
import { bodyLabel, hasErrorUnder, METHODS, useBuilder } from './draft'
import { KVEditor } from './kv-editor'
import { TemplateInput } from './template-input'
import { TryResultView } from './try-panel'
import { useTry } from './use-try'

/** Editor for one request. The address bar comes first; everything optional starts folded. */
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
  const { errors, environmentId, baseUrl, readOnly } = useBuilder()
  const [variant, setVariant] = useState(0)
  const send = useTry(onTryErrors)
  const step = flow.steps[0]
  const path = `flows.${index}.steps.0`
  const setStep = (patch: Partial<Step>) => {
    const s = { ...step, ...patch }
    onChange({ ...flow, name: s.name, enabled: s.enabled, steps: [s] })
  }
  const nameErr = errors.get(`${path}.name`) ?? errors.get(`flows.${index}.name`)
  const urlErr = errors.get(`${path}.url`) ?? errors.get(`${path}.method`)
  const full = fullUrl(baseUrl, step.url)
  const queryCount = step.query.filter((q) => q.enabled).length
  const headerCount = step.headers.filter((h) => h.enabled).length

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <div className="grid gap-2">
        <Label htmlFor="ep-url">Request</Label>
        <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-start gap-2 sm:grid-cols-[6.5rem_minmax(0,1fr)_auto]">
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
          <TemplateInput id="ep-url" aria-label="URL" placeholder="/products" value={step.url} onChange={(url) => setStep({ url })} error={urlErr} />
          <Button type="button" variant="outline" className="col-span-2 sm:col-span-1" disabled={send.isPending} onClick={() => send.mutate({ step, environmentId, variant })}>
            <SendIcon />
            {send.isPending ? 'Sending' : 'Send test request'}
          </Button>
        </div>
        {!urlErr && full && isLocalhost(full) && (
          <p className="text-xs text-muted-foreground">
            ndswarm usually runs in Docker, where localhost means the ndswarm container itself. For an API on this computer use{' '}
            <code className="font-mono">host.docker.internal</code> instead of localhost.
          </p>
        )}
        {!urlErr && (
          <p className="truncate font-mono text-xs text-muted-foreground" title={full ?? undefined}>
            {full ?? 'This is a path, but the test has no server address. Choose a server at the top, or enter a full URL.'}
          </p>
        )}
      </div>

      <TryResultView run={send} />

      <div className="grid grid-cols-[minmax(0,1fr)] items-end gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
        <div className="grid gap-2">
          <Label htmlFor="ep-name">Name in results</Label>
          <Input id="ep-name" value={step.name} aria-invalid={nameErr ? true : undefined} onChange={(e) => setStep({ name: e.target.value })} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="ep-weight" className="flex items-center gap-1">
            Traffic share
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" aria-label="About traffic share" className="text-muted-foreground">
                  <CircleHelpIcon className="size-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-64">
                How often users pick this request compared with the others. A weight of 2 is picked twice as often as a weight of 1.
              </TooltipContent>
            </Tooltip>
          </Label>
          <div className="flex items-center gap-2">
            <NumberInput
              id="ep-weight"
              min={0}
              className="w-20"
              value={flow.weight}
              onCommit={(weight) => onChange({ ...flow, weight })}
              onBlur={() => onChange({ ...flow, weight: Math.max(0, Math.round(flow.weight) || 0) })}
            />
            <span className="w-36 text-sm whitespace-nowrap text-muted-foreground tabular-nums">{share === null ? 'not sent' : `${share.toFixed(0)}% of requests`}</span>
          </div>
        </div>
      </div>
      {nameErr && <p className="-mt-3 text-sm text-destructive">{nameErr}</p>}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
        <Disclosure title="Query parameters" summary={queryCount ? `${queryCount} set` : 'none'} defaultOpen={step.query.length > 0} error={hasErrorUnder(errors, `${path}.query`)}>
          <p className="mb-3 text-sm text-muted-foreground">Added after ? in the URL, and encoded for you.</p>
          <KVEditor items={step.query} onChange={(query) => setStep({ query })} path={`${path}.query`} keyLabel="Parameter" />
        </Disclosure>
        <Disclosure title="Headers" summary={headerCount ? `${headerCount} set` : 'none'} defaultOpen={step.headers.length > 0} error={hasErrorUnder(errors, `${path}.headers`)}>
          <p className="mb-3 text-sm text-muted-foreground">Sent with this request. They replace the server's headers with the same name.</p>
          <KVEditor items={step.headers} onChange={(headers) => setStep({ headers })} path={`${path}.headers`} keyLabel="Header" />
        </Disclosure>
        <Disclosure title="Body" summary={bodyLabel(step.body)} defaultOpen={step.body.type !== 'none'} error={hasErrorUnder(errors, `${path}.body`)}>
          <BodyEditor body={step.body} onChange={(body) => setStep({ body })} path={`${path}.body`} selected={variant} onSelect={setVariant} />
        </Disclosure>
        <Disclosure
          title="More options"
          summary={`times out after ${step.timeoutMs / 1000} s, ${step.followRedirects ? 'follows' : 'does not follow'} redirects`}
          error={!!errors.get(`${path}.timeoutMs`)}
        >
          <div className="flex flex-wrap items-end gap-6">
            <div className="grid gap-2">
              <Label htmlFor="ep-timeout">Give up after (ms)</Label>
              <NumberInput
                id="ep-timeout"
                min={1}
                max={300_000}
                className="w-32"
                value={step.timeoutMs}
                invalid={!!errors.get(`${path}.timeoutMs`)}
                onCommit={(timeoutMs) => setStep({ timeoutMs })}
                onBlur={() => setStep({ timeoutMs: Math.min(300_000, Math.max(1, Math.round(step.timeoutMs) || 1)) })}
              />
            </div>
            <label className="flex items-center gap-2 pb-1.5 text-sm">
              <Switch checked={step.followRedirects} disabled={readOnly} onCheckedChange={(followRedirects) => setStep({ followRedirects })} />
              Follow redirects
            </label>
          </div>
          {errors.get(`${path}.timeoutMs`) && <p className="mt-2 text-sm text-destructive">{errors.get(`${path}.timeoutMs`)}</p>}
          <p className="mt-2 text-sm text-muted-foreground">A request that takes longer counts as a timeout failure.</p>
        </Disclosure>
      </div>
    </div>
  )
}

function isLocalhost(u: string): boolean {
  try {
    return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(u).hostname)
  } catch {
    return false
  }
}

/** The address a path resolves to, for a quick sanity check. */
function fullUrl(base: string, url: string): string | null {
  const u = url.trim()
  if (/^https?:\/\//.test(u)) return u
  if (!base) return null
  return base.replace(/\/+$/, '') + '/' + u.replace(/^\/+/, '')
}
