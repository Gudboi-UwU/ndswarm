import { useQuery } from '@tanstack/react-query'
import { DownloadIcon } from 'lucide-react'
import { useState } from 'react'
import { api, errorMessage } from '@/api/client'
import type { IntervalRow, RunKey, Stats, StatusRow } from '@/api/types'
import { AggNote, AggPicker } from '@/components/agg-picker'
import { Help, HelpIcon } from '@/components/table-help'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatElapsed, formatNumber } from '@/lib/format'
import { aggregate, saveAggMode, savedAggMode, type AggMode } from '@/lib/aggregate'
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
          {inexact && ' Response times need slices in multiples of 5 seconds (10 seconds for runs made before 0.0.3), so they are left empty here.'}
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

const INTERVAL_MODES: AggMode[] = ['combined', 'mean', 'median', 'max', 'min']

function IntervalTable({ rows, total }: { rows: IntervalRow[]; total?: Stats }) {
  const [mode, setMode] = useState<AggMode>(() => {
    const m = savedAggMode()
    return INTERVAL_MODES.includes(m) ? m : 'combined'
  })
  const ms = (r: { exact: boolean }, v: number) => (r.exact ? formatNumber(v, 1) : '-')
  const pick = (m: AggMode) => {
    setMode(m)
    saveAggMode(m)
  }
  // Latency statistics only use slices that have exact figures.
  const exact = rows.filter((r) => r.exact)
  const stat = (f: (r: IntervalRow) => number, all = rows) => aggregate(all.map(f), mode as Exclude<AggMode, 'combined'>)
  const foot: (IntervalRow & { pct: number }) | null =
    mode === 'combined'
      ? total
        ? { fromSec: 0, toSec: 0, count: total.count, ok: total.ok, err: total.err, rps: total.rps, avg: total.avg, p50: total.p50, p90: total.p90, p95: total.p95, p99: total.p99, max: total.max, exact: true, pct: total.count ? (total.err / total.count) * 100 : 0 }
        : null
      : {
          fromSec: 0,
          toSec: 0,
          count: stat((r) => r.count),
          ok: stat((r) => r.ok),
          err: stat((r) => r.err),
          rps: stat((r) => r.rps),
          avg: exact.length ? stat((r) => r.avg, exact) : 0,
          p50: exact.length ? stat((r) => r.p50, exact) : 0,
          p90: exact.length ? stat((r) => r.p90, exact) : 0,
          p95: exact.length ? stat((r) => r.p95, exact) : 0,
          p99: exact.length ? stat((r) => r.p99, exact) : 0,
          max: exact.length ? stat((r) => r.max, exact) : 0,
          exact: exact.length > 0,
          pct: stat((r) => (r.count ? (r.err / r.count) * 100 : 0)),
        }
  const failed = (count: number, err: number, pct: number) => (
    <>
      <span className={cn(err > 0 && 'text-destructive')}>{formatNumber(err, Number.isInteger(err) ? 0 : 1)}</span>
      <span className={cn('ml-1.5 text-xs', err > 0 ? 'text-destructive/80' : 'text-muted-foreground')}>{formatNumber(pct, pct > 0 && pct < 1 ? 2 : 1)}%</span>
      <span className="sr-only"> of {formatNumber(count)}</span>
    </>
  )
  const head = (label: string, help: string) => (
    <TableHead className="text-right">
      <Help help={help}>{label}</Help>
    </TableHead>
  )

  return (
    <div className="grid gap-2">
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader className="bg-muted/40">
            <TableRow className="hover:bg-transparent">
              <TableHead>
                <Help help={glossary.interval}>Time</Help>
              </TableHead>
              {head('Sent', glossary.sent)}
              {head('Failed', glossary.failed)}
              {head('Per second', glossary.rps)}
              {head('Average, ms', glossary.avg)}
              {head('Half within, ms', glossary.p50)}
              {head('95% within, ms', glossary.p95)}
              {head('99% within, ms', glossary.p99)}
              {head('Slowest, ms', glossary.max)}
            </TableRow>
          </TableHeader>
          <TableBody className="font-mono text-sm tabular-nums">
            {rows.map((r) => (
              <TableRow key={r.fromSec}>
                <TableCell className="whitespace-nowrap">
                  {formatElapsed(r.fromSec)}
                  <span className="text-muted-foreground"> to </span>
                  {formatElapsed(r.toSec)}
                </TableCell>
                <TableCell className="text-right">{formatNumber(r.count)}</TableCell>
                <TableCell className="text-right">{failed(r.count, r.err, r.count ? (r.err / r.count) * 100 : 0)}</TableCell>
                <TableCell className="text-right">{formatNumber(r.rps, 1)}</TableCell>
                <TableCell className="text-right">{ms(r, r.avg)}</TableCell>
                <TableCell className="text-right">{ms(r, r.p50)}</TableCell>
                <TableCell className="text-right">{ms(r, r.p95)}</TableCell>
                <TableCell className="text-right">{ms(r, r.p99)}</TableCell>
                <TableCell className="text-right">{ms(r, r.max)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
          {foot && rows.length > 1 && (
            <tfoot className="border-t-2 bg-muted/40 font-mono text-sm font-semibold tabular-nums">
              <TableRow className="hover:bg-muted/40">
                <TableCell className="font-sans">
                  <AggPicker value={mode} onChange={pick} modes={INTERVAL_MODES} />
                </TableCell>
                <TableCell className="text-right">{formatNumber(foot.count, Number.isInteger(foot.count) ? 0 : 1)}</TableCell>
                <TableCell className="text-right">{failed(foot.count, foot.err, foot.pct)}</TableCell>
                <TableCell className="text-right">{formatNumber(foot.rps, 1)}</TableCell>
                <TableCell className="text-right">{ms(foot, foot.avg)}</TableCell>
                <TableCell className="text-right">{ms(foot, foot.p50)}</TableCell>
                <TableCell className="text-right">{ms(foot, foot.p95)}</TableCell>
                <TableCell className="text-right">{ms(foot, foot.p99)}</TableCell>
                <TableCell className="text-right">{ms(foot, foot.max)}</TableCell>
              </TableRow>
            </tfoot>
          )}
        </Table>
      </div>
      {rows.length > 1 && <AggNote value={mode} />}
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
        <TableHeader className="bg-muted/40">
          <TableRow className="hover:bg-transparent">
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
            <TableRow className="border-t-2 bg-muted/40 font-semibold hover:bg-muted/40">
              <TableCell className="font-sans">
                <Help help="Every request added up. Counts are simply summed.">Sum of all requests</Help>
              </TableCell>
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
