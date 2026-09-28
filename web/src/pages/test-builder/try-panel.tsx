import type { useTry } from './use-try'
import { useState } from 'react'
import { ApiError, errorMessage } from '@/api/client'
import { Code, Waterfall } from '@/components/http-view'
import { Badge } from '@/components/ui/badge'
import { formatBytes, headerText, pretty } from '@/lib/format'
import { categoryLabel } from '@/lib/run'
import { cn } from '@/lib/utils'

/** What the test request sent and got back. */
export function TryResultView({ run }: { run: ReturnType<typeof useTry> }) {
  const [tab, setTab] = useState<'body' | 'headers' | 'request'>('body')
  if (run.isIdle) return null
  if (run.isPending) return <p className="rounded-lg border p-4 text-sm text-muted-foreground">Sending...</p>
  if (run.isError) {
    const fields = run.error instanceof ApiError && run.error.details.length > 0
    return <p className="rounded-lg border p-4 text-sm text-destructive">{fields ? 'Fix the fields marked in red, then send again.' : errorMessage(run.error)}</p>
  }
  const r = run.data
  if (!r) return null
  const ok = r.response && r.response.status < 400 && !r.error

  return (
    <section className="grid gap-3 rounded-lg border p-4" aria-label="Test request result">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-medium">{ok ? 'The server answered' : 'The request failed'}</span>
        {r.response && (
          <Badge variant={r.response.status < 400 ? 'default' : 'destructive'} className="font-mono">
            {r.response.status} {r.response.statusText}
          </Badge>
        )}
        {r.timing && <span className="font-mono text-sm tabular-nums">{r.timing.total.toFixed(1)} ms</span>}
        {r.response && <span className="font-mono text-sm text-muted-foreground tabular-nums">{formatBytes(r.response.size)}</span>}
      </div>
      {r.error && (
        <p className="rounded-md bg-destructive/10 p-2 text-sm text-destructive">
          <span className="font-medium">{categoryLabel[r.error.category] ?? r.error.category}:</span> {r.error.message}
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
                {t === 'body' ? 'Response' : t === 'headers' ? 'Response headers' : 'What was sent'}
              </button>
            ))}
          </div>
          {tab === 'body' && (r.response ? <Code text={pretty(r.response.body)} note={r.response.truncated ? 'Showing the first 64 KB.' : undefined} /> : <p className="text-sm text-muted-foreground">No response.</p>)}
          {tab === 'headers' && r.response && <Code text={headerText(r.response.headers)} />}
          {tab === 'request' && <Code text={`${r.request.method} ${r.request.url}\n${headerText(r.request.headers)}\n\n${pretty(r.request.body)}`} />}
        </>
      )}
    </section>
  )
}
