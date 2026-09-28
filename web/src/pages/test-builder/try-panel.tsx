import { useMutation } from '@tanstack/react-query'
import { PlayIcon } from 'lucide-react'
import { useState } from 'react'
import { api, ApiError, errorMessage } from '@/api/client'
import type { Step, Timing, TryResult } from '@/api/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/** Sends the step once with the chosen variant and shows what went out and came back. */
export function TryPanel({ step, environmentId, variant, onValidationError }: { step: Step; environmentId: number | null; variant: number; onValidationError: (e: ApiError) => void }) {
  const [tab, setTab] = useState<'body' | 'headers' | 'request'>('body')
  const run = useMutation({
    mutationFn: () => api<TryResult>('POST', '/tools/try', { step, environmentId, variant }),
    onError: (e) => e instanceof ApiError && e.details.length && onValidationError(e),
  })
  const r = run.data

  return (
    <section className="rounded-lg border" aria-label="Try this endpoint">
      <div className="flex flex-wrap items-center gap-3 border-b p-3">
        <Button type="button" variant="outline" onClick={() => run.mutate()} disabled={run.isPending}>
          <PlayIcon />
          {run.isPending ? 'Sending' : 'Try once'}
        </Button>
        <p className="text-sm text-muted-foreground">Sends one real request{step.body.variants.length > 1 ? ' using the selected variant' : ''}. Unsaved changes are included.</p>
      </div>
      {run.isError && !(run.error instanceof ApiError && run.error.details.length) && <p className="p-3 text-sm text-destructive">{errorMessage(run.error)}</p>}
      {run.error instanceof ApiError && run.error.details.length > 0 && <p className="p-3 text-sm text-destructive">Fix the highlighted fields first.</p>}
      {r && (
        <div className="grid gap-3 p-3">
          <div className="flex flex-wrap items-center gap-3">
            {r.response && (
              <Badge variant={r.response.status < 400 ? 'default' : 'destructive'} className="font-mono">
                {r.response.status} {r.response.statusText}
              </Badge>
            )}
            {r.timing && <span className="font-mono text-sm tabular-nums">{r.timing.total.toFixed(1)} ms</span>}
            {r.response && <span className="font-mono text-sm text-muted-foreground tabular-nums">{formatBytes(r.response.size)}</span>}
            {r.request?.variant && <span className="text-sm text-muted-foreground">variant: {r.request.variant}</span>}
          </div>
          {r.error && (
            <p className="rounded-md bg-destructive/10 p-2 text-sm text-destructive">
              <span className="font-medium">{r.error.category}</span>: {r.error.message}
            </p>
          )}
          {r.timing && r.response && <Waterfall t={r.timing} />}
          {r.request && (
            <>
              <div className="flex gap-1 border-b" role="tablist">
                {(['body', 'headers', 'request'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    role="tab"
                    aria-selected={tab === t}
                    onClick={() => setTab(t)}
                    className={cn('-mb-px border-b-2 px-3 py-1.5 text-sm', tab === t ? 'border-primary font-medium' : 'border-transparent text-muted-foreground')}
                  >
                    {t === 'body' ? 'Response body' : t === 'headers' ? 'Response headers' : 'Request sent'}
                  </button>
                ))}
              </div>
              {tab === 'body' && (r.response ? <Code text={pretty(r.response.body)} note={r.response.truncated ? 'Showing the first 64 KB.' : undefined} /> : <p className="text-sm text-muted-foreground">No response.</p>)}
              {tab === 'headers' && r.response && <Code text={headerText(r.response.headers)} />}
              {tab === 'request' && <Code text={`${r.request.method} ${r.request.url}\n${headerText(r.request.headers)}\n\n${pretty(r.request.body)}`} />}
            </>
          )}
        </div>
      )}
    </section>
  )
}

function Waterfall({ t }: { t: Timing }) {
  const phases: [string, number][] = [
    ['DNS', t.dns],
    ['Connect', t.connect],
    ['TLS', t.tls],
    ['Waiting', t.ttfb],
    ['Download', t.download],
  ]
  const total = Math.max(t.total, 0.001)
  return (
    <dl className="grid grid-cols-[5rem_1fr_5rem] items-center gap-x-3 gap-y-1 text-xs">
      {phases.map(([name, ms]) => (
        <div key={name} className="contents">
          <dt className="text-muted-foreground">{name}</dt>
          <div className="h-1.5">
            <div className="h-full rounded-full bg-primary/70" style={{ width: `${Math.max((ms / total) * 100, ms > 0 ? 1 : 0)}%` }} />
          </div>
          <dd className="text-right font-mono tabular-nums">{ms.toFixed(1)} ms</dd>
        </div>
      ))}
      {t.reused && <p className="col-span-3 text-muted-foreground">Connection reused, so DNS, connect and TLS were skipped.</p>}
    </dl>
  )
}

function Code({ text, note }: { text: string; note?: string }) {
  return (
    <div>
      <pre className="max-h-96 overflow-auto rounded-md bg-muted p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-all">{text || '(empty)'}</pre>
      {note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}
    </div>
  )
}

function pretty(body: string): string {
  try {
    return JSON.stringify(JSON.parse(body), null, 2)
  } catch {
    return body
  }
}

function headerText(h: Record<string, string[]>): string {
  return Object.entries(h)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, vs]) => vs.map((v) => `${k}: ${v}`).join('\n'))
    .join('\n')
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
