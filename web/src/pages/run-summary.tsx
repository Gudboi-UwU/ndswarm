import { useQuery } from '@tanstack/react-query'
import { DownloadIcon } from 'lucide-react'
import { useState } from 'react'
import { api, errorMessage } from '@/api/client'
import type { IntervalRow, RunKey, StatusRow } from '@/api/types'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatElapsed, formatNumber } from '@/lib/format'
import { keyLabel } from '@/lib/run'
import { cn } from '@/lib/utils'

/** Aggregates of the whole run: per time interval (exact percentiles) and per status code. */
export function SummaryTab({ runId, keys: runKeys, live }: { runId: number; keys: RunKey[]; live: boolean }) {
  const [size, setSize] = useState<10 | 60>(10)
  const intervals = useQuery({
    queryKey: ['run', runId, 'intervals', size],
    queryFn: () => api<IntervalRow[]>('GET', `/runs/${runId}/summary?by=interval&interval=${size}`),
    refetchInterval: live ? 5000 : false,
  })
  const statuses = useQuery({ queryKey: ['run', runId, 'statuses'], queryFn: () => api<StatusRow[]>('GET', `/runs/${runId}/summary?by=status`), enabled: !live })

  return (
    <div className="grid gap-8">
      <section className="grid gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-medium">Per interval</h2>
          <div className="flex rounded-md border p-0.5" role="radiogroup" aria-label="Interval">
            {([10, 60] as const).map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={size === n}
                onClick={() => setSize(n)}
                className={cn('rounded px-2.5 py-1 text-sm', size === n ? 'bg-muted font-medium' : 'text-muted-foreground')}
              >
                {n === 10 ? '10 seconds' : '1 minute'}
              </button>
            ))}
          </div>
        </div>
        {intervals.isPending ? (
          <Skeleton className="h-40" />
        ) : intervals.isError ? (
          <p className="text-sm text-destructive">{errorMessage(intervals.error)}</p>
        ) : intervals.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">No complete interval yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>From</TableHead>
                  <TableHead className="text-right">Requests</TableHead>
                  <TableHead className="text-right">Errors</TableHead>
                  <TableHead className="text-right">Req/s</TableHead>
                  <TableHead className="text-right">Avg</TableHead>
                  <TableHead className="text-right">p50</TableHead>
                  <TableHead className="text-right">p95</TableHead>
                  <TableHead className="text-right">p99</TableHead>
                  <TableHead className="text-right">Max</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className="font-mono text-sm tabular-nums">
                {intervals.data.map((r) => (
                  <TableRow key={r.fromSec}>
                    <TableCell>
                      {formatElapsed(r.fromSec)} to {formatElapsed(r.toSec)}
                    </TableCell>
                    <TableCell className="text-right">{formatNumber(r.count)}</TableCell>
                    <TableCell className={cn('text-right', r.err > 0 && 'text-destructive')}>
                      {formatNumber(r.err)} ({formatNumber(r.count ? (r.err / r.count) * 100 : 0, 1)}%)
                    </TableCell>
                    <TableCell className="text-right">{formatNumber(r.rps, 1)}</TableCell>
                    <TableCell className="text-right">{formatNumber(r.avg, 1)}</TableCell>
                    <TableCell className="text-right">{formatNumber(r.p50, 1)}</TableCell>
                    <TableCell className="text-right">{formatNumber(r.p95, 1)}</TableCell>
                    <TableCell className="text-right">{formatNumber(r.p99, 1)}</TableCell>
                    <TableCell className="text-right">{formatNumber(r.max, 1)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        <p className="text-sm text-muted-foreground">Latency in ms. Percentiles are computed from the full distribution of each interval, not averaged.</p>
      </section>

      <section className="grid gap-3">
        <h2 className="text-lg font-medium">Status codes per endpoint</h2>
        {live ? (
          <p className="text-sm text-muted-foreground">Available when the run ends. The overview shows totals for the whole run.</p>
        ) : statuses.isPending ? (
          <Skeleton className="h-24" />
        ) : statuses.isError ? (
          <p className="text-sm text-destructive">{errorMessage(statuses.error)}</p>
        ) : (
          <StatusTable rows={statuses.data} runKeys={runKeys} />
        )}
      </section>
    </div>
  )
}

function StatusTable({ rows, runKeys }: { rows: StatusRow[]; runKeys: RunKey[] }) {
  const codes = [...new Set(rows.map((r) => r.code).filter((c) => /^\d+$/.test(c)))].sort()
  const byKey = new Map<number, Map<string, number>>()
  for (const r of rows) {
    if (!byKey.has(r.keyId)) byKey.set(r.keyId, new Map())
    byKey.get(r.keyId)!.set(r.code, r.count)
  }
  if (codes.length === 0) return <p className="text-sm text-muted-foreground">No responses were received.</p>
  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Endpoint</TableHead>
            {codes.map((c) => (
              <TableHead key={c} className={cn('text-right font-mono', Number(c) >= 400 && 'text-destructive')}>
                {c}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody className="font-mono text-sm tabular-nums">
          {runKeys.map((k) => (
            <TableRow key={k.keyId}>
              <TableCell className="font-sans">{keyLabel(k)}</TableCell>
              {codes.map((c) => (
                <TableCell key={c} className="text-right">
                  {formatNumber(byKey.get(k.keyId)?.get(c) ?? 0)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

export function ExportMenu({ runId }: { runId: number }) {
  const link = (what: string, format: string) => `/api/v1/runs/${runId}/export?what=${what}&format=${format}`
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          <DownloadIcon />
          Export
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {[
          ['summary', 'Summary per endpoint'],
          ['timeseries', 'Every second'],
          ['logs', 'Logged requests'],
        ].map(([what, label], i) => (
          <div key={what}>
            {i > 0 && <DropdownMenuSeparator />}
            <DropdownMenuLabel className="text-xs text-muted-foreground">{label}</DropdownMenuLabel>
            <DropdownMenuItem asChild>
              <a href={link(what, 'csv')} download>
                CSV
              </a>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <a href={link(what, 'json')} download>
                JSON
              </a>
            </DropdownMenuItem>
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
