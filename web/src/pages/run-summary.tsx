import { useQuery } from '@tanstack/react-query'
import { DownloadIcon } from 'lucide-react'
import { useState } from 'react'
import { api, errorMessage } from '@/api/client'
import type { IntervalRow, RunKey, Stats, StatusRow } from '@/api/types'
import { Help, HelpIcon } from '@/components/table-help'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatElapsed, formatNumber } from '@/lib/format'
import { glossary } from '@/lib/glossary'
import { keyLabel, statusText } from '@/lib/run'
import { cn } from '@/lib/utils'

const PRESETS = [5, 10, 30, 60]

/** Aggregates of the whole run: per time interval (exact percentiles) and per status code. */
export function SummaryTab({ runId, keys: runKeys, live, total }: { runId: number; keys: RunKey[]; live: boolean; total?: Stats }) {
  const [size, setSize] = useState(10)
  const [custom, setCustom] = useState(false)
  const [customValue, setCustomValue] = useState('2')
  const [customUnit, setCustomUnit] = useState<1 | 60>(60)
  const intervals = useQuery({
    queryKey: ['run', runId, 'intervals', size],
    queryFn: () => api<IntervalRow[]>('GET', `/runs/${runId}/summary?by=interval&interval=${size}`),
    refetchInterval: live ? 5000 : false,
  })
  const statuses = useQuery({ queryKey: ['run', runId, 'statuses'], queryFn: () => api<StatusRow[]>('GET', `/runs/${runId}/summary?by=status`), enabled: !live })
  const applyCustom = (v: string, unit: 1 | 60) => {
    const n = Math.round(Number(v) * unit)
    if (n >= 1) setSize(n)
  }
  const inexact = intervals.data?.some((r) => !r.exact && r.count > 0)

  return (
    <div className="grid gap-8">
      <section className="grid gap-3">
        <div>
          <h2 className="text-lg font-medium">Over time</h2>
          <p className="text-sm text-muted-foreground">The run cut into equal slices. Useful to see when things got slower or started failing.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">Each row covers</span>
          <div className="flex rounded-md border p-0.5" role="radiogroup" aria-label="Interval">
            {PRESETS.map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={!custom && size === n}
                onClick={() => {
                  setCustom(false)
                  setSize(n)
                }}
                className={cn('rounded px-2.5 py-1 text-sm', !custom && size === n ? 'bg-muted font-medium' : 'text-muted-foreground hover:text-foreground')}
              >
                {n < 60 ? `${n} seconds` : '1 minute'}
              </button>
            ))}
            <button
              type="button"
              role="radio"
              aria-checked={custom}
              onClick={() => {
                setCustom(true)
                applyCustom(customValue, customUnit)
              }}
              className={cn('rounded px-2.5 py-1 text-sm', custom ? 'bg-muted font-medium' : 'text-muted-foreground hover:text-foreground')}
            >
              Custom
            </button>
          </div>
          {custom && (
            <div className="flex items-center gap-2">
              <Input
                aria-label="Custom interval"
                type="number"
                min={1}
                className="w-20 font-mono"
                value={customValue}
                onChange={(e) => {
                  setCustomValue(e.target.value)
                  applyCustom(e.target.value, customUnit)
                }}
              />
              <select
                aria-label="Custom interval unit"
                className="h-8 rounded-lg border bg-transparent px-2 text-sm dark:bg-input/30"
                value={customUnit}
                onChange={(e) => {
                  const u = Number(e.target.value) as 1 | 60
                  setCustomUnit(u)
                  applyCustom(customValue, u)
                }}
              >
                <option value={1}>seconds</option>
                <option value={60}>minutes</option>
              </select>
            </div>
          )}
        </div>
        {intervals.isPending ? (
          <Skeleton className="h-40" />
        ) : intervals.isError ? (
          <p className="text-sm text-destructive">{errorMessage(intervals.error)}</p>
        ) : intervals.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">No complete interval yet.</p>
        ) : (
          <IntervalTable rows={intervals.data} total={total} />
        )}
        <p className="text-sm text-muted-foreground">
          Times in milliseconds. Percentiles are exact for each slice, computed from every request in it.
          {inexact && ' Response times need slices in multiples of 5 seconds (10 seconds for runs made before version 0.0.3), so they are left empty here.'}
        </p>
      </section>

      <section className="grid gap-3">
        <div>
          <h2 className="text-lg font-medium">
            Status codes per request
            <HelpIcon label="status codes" help={glossary.status} />
          </h2>
          <p className="text-sm text-muted-foreground">How the server answered each request.</p>
        </div>
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

function IntervalTable({ rows, total }: { rows: IntervalRow[]; total?: Stats }) {
  const ms = (r: IntervalRow, v: number) => (r.exact ? formatNumber(v, 1) : '-')
  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>
              <Help help={glossary.interval}>Time</Help>
            </TableHead>
            <TableHead className="text-right">
              <Help help={glossary.sent}>Sent</Help>
            </TableHead>
            <TableHead className="text-right">
              <Help help={glossary.failed}>Failed</Help>
            </TableHead>
            <TableHead className="text-right">
              <Help help={glossary.rps}>Per second</Help>
            </TableHead>
            <TableHead className="text-right">
              <Help help={glossary.avg}>Average</Help>
            </TableHead>
            <TableHead className="text-right">
              <Help help={glossary.p50}>Half within</Help>
            </TableHead>
            <TableHead className="text-right">
              <Help help={glossary.p95}>95% within</Help>
            </TableHead>
            <TableHead className="text-right">
              <Help help={glossary.p99}>99% within</Help>
            </TableHead>
            <TableHead className="text-right">
              <Help help={glossary.max}>Slowest</Help>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody className="font-mono text-sm tabular-nums">
          {rows.map((r) => (
            <TableRow key={r.fromSec}>
              <TableCell>
                {formatElapsed(r.fromSec)} to {formatElapsed(r.toSec)}
              </TableCell>
              <TableCell className="text-right">{formatNumber(r.count)}</TableCell>
              <TableCell className={cn('text-right', r.err > 0 && 'text-destructive')}>
                {formatNumber(r.err)} ({formatNumber(r.count ? (r.err / r.count) * 100 : 0, 1)}%)
              </TableCell>
              <TableCell className="text-right">{formatNumber(r.rps, 1)}</TableCell>
              <TableCell className="text-right">{ms(r, r.avg)}</TableCell>
              <TableCell className="text-right">{ms(r, r.p50)}</TableCell>
              <TableCell className="text-right">{ms(r, r.p95)}</TableCell>
              <TableCell className="text-right">{ms(r, r.p99)}</TableCell>
              <TableCell className="text-right">{ms(r, r.max)}</TableCell>
            </TableRow>
          ))}
          {total && rows.length > 1 && (
            <TableRow className="border-t-2 bg-muted/40 font-semibold">
              <TableCell className="font-sans">
                <Help help={glossary.total}>Whole run</Help>
              </TableCell>
              <TableCell className="text-right">{formatNumber(total.count)}</TableCell>
              <TableCell className={cn('text-right', total.err > 0 && 'text-destructive')}>
                {formatNumber(total.err)} ({formatNumber(total.count ? (total.err / total.count) * 100 : 0, 1)}%)
              </TableCell>
              <TableCell className="text-right">{formatNumber(total.rps, 1)}</TableCell>
              <TableCell className="text-right">{formatNumber(total.avg, 1)}</TableCell>
              <TableCell className="text-right">{formatNumber(total.p50, 1)}</TableCell>
              <TableCell className="text-right">{formatNumber(total.p95, 1)}</TableCell>
              <TableCell className="text-right">{formatNumber(total.p99, 1)}</TableCell>
              <TableCell className="text-right">{formatNumber(total.max, 1)}</TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  )
}

function StatusTable({ rows, runKeys }: { rows: StatusRow[]; runKeys: RunKey[] }) {
  const codes = [...new Set(rows.map((r) => r.code).filter((c) => /^\d+$/.test(c)))].sort()
  const byKey = new Map<number, Map<string, number>>()
  const totals = new Map<string, number>()
  for (const r of rows) {
    if (!byKey.has(r.keyId)) byKey.set(r.keyId, new Map())
    byKey.get(r.keyId)!.set(r.code, r.count)
    totals.set(r.code, (totals.get(r.code) ?? 0) + r.count)
  }
  if (codes.length === 0) return <p className="text-sm text-muted-foreground">No responses were received.</p>
  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Request</TableHead>
            {codes.map((c) => (
              <TableHead key={c} className={cn('text-right font-mono', Number(c) >= 400 && 'text-destructive')}>
                <Help help={`${c} ${statusText[c] ?? ''}. ${Number(c) >= 400 ? 'Counts as failed.' : 'Counts as success.'}`}>{c}</Help>
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
          {runKeys.length > 1 && (
            <TableRow className="border-t-2 bg-muted/40 font-semibold">
              <TableCell className="font-sans">Total, all requests</TableCell>
              {codes.map((c) => (
                <TableCell key={c} className="text-right">
                  {formatNumber(totals.get(c) ?? 0)}
                </TableCell>
              ))}
            </TableRow>
          )}
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
