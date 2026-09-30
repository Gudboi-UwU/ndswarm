import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CircleCheckIcon, CircleHelpIcon, CircleXIcon, SquareIcon, Trash2Icon } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { useMe } from '@/api/auth'
import { api, ApiError, errorMessage } from '@/api/client'
import { keys } from '@/api/keys'
import type { Point, Project, Run, RunKey, Stats, Tick, ThresholdResult } from '@/api/types'
import { useRunStream } from '@/api/ws'
import { ConfirmDelete } from '@/components/page'
import { AggNote, AggPicker } from '@/components/agg-picker'
import { RunStatus } from '@/components/run-table'
import { Help, HelpIcon, SortButton } from '@/components/table-help'
import { TimeChart, type ChartSeries } from '@/components/time-chart'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { formatBytes, formatDate, formatElapsed, formatNumber } from '@/lib/format'
import { aggregate, saveAggMode, savedAggMode, type AggMode } from '@/lib/aggregate'
import { glossary } from '@/lib/glossary'
import { categoryLabel, emptyFilters, keyLabel, statusText, type LogFilters } from '@/lib/run'
import { sortRows, type SortState } from '@/lib/sort'
import { resultSentence } from '@/lib/thresholds'
import { cn } from '@/lib/utils'
import { NotFoundPage } from './not-found'
import { ErrorsTab } from './run-errors'
import { LogsTab } from './run-logs'
import { ExportMenu, SummaryTab } from './run-summary'

// Latency percentiles are ordinal: one hue, darker = higher percentile (light) / brighter (dark).
// Validated with the dataviz palette checks against both surfaces.
const LATENCY: ChartSeries[] = [
  { label: 'Half of requests within', color: ['#10b981', '#047857'] },
  { label: '95% within', color: ['#047857', '#10b981'] },
  { label: '99% within', color: ['#022c22', '#6ee7b7'] },
]
const RPS: ChartSeries[] = [{ label: 'Requests/s', color: '--primary', fill: true }]
const ERRORS: ChartSeries[] = [{ label: 'Failed/s', color: '--destructive', fill: true }]
const NO_POINTS: Point[] = []
const VUS: ChartSeries[] = [{ label: 'Users', color: '--muted-foreground' }]

export function RunPage() {
  const id = Number(useParams().id)
  const run = useQuery({ queryKey: keys.run(id), queryFn: () => api<Run>('GET', `/runs/${id}`) })
  if (run.error instanceof ApiError && run.error.status === 404) return <NotFoundPage />
  if (run.isError) return <p className="text-sm text-destructive">{errorMessage(run.error)}</p>
  if (run.isPending) return <RunSkeleton />
  return <RunView key={id} run={run.data} />
}

function RunSkeleton() {
  return (
    <div className="grid gap-6">
      <Skeleton className="h-9 w-72" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        {Array.from({ length: 7 }, (_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <Skeleton className="h-64" />
    </div>
  )
}

function RunView({ run }: { run: Run }) {
  const { data: me } = useMe()
  const queryClient = useQueryClient()
  const live = run.status === 'running' || run.status === 'stopping'
  const [tick, setTick] = useState<Tick | undefined>(run.live)
  const [status, setStatus] = useState(run.status)
  const [stopping, setStopping] = useState(false)
  const project = useQuery({ queryKey: keys.project(run.projectId ?? 0), queryFn: () => api<Project>('GET', `/projects/${run.projectId}`), enabled: !!run.projectId })
  const [deleting, setDeleting] = useState(false)
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') ?? 'overview'
  const setTab = (t: string) => setParams(t === 'overview' ? {} : { tab: t }, { replace: true })
  const [filters, setFilters] = useState<LogFilters>(emptyFilters)
  const showLogs = (f: Partial<LogFilters>) => {
    setFilters({ ...emptyFilters, ...f })
    setTab('logs')
  }
  const navigate = useNavigate()
  const remove = useMutation({
    mutationFn: () => api<void>('DELETE', `/runs/${run.id}`),
    onSuccess: async () => {
      toast.success(`Deleted run #${run.id}`)
      await navigate(run.testId ? `/tests/${run.testId}` : '/runs')
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const series = useQuery({ queryKey: keys.timeseries(run.id), queryFn: () => api<Point[]>('GET', `/runs/${run.id}/timeseries`) })

  useRunStream(run.id, live, {
    onTick: (t) => {
      setTick(t)
      queryClient.setQueryData<Point[]>(keys.timeseries(run.id), (prev = []) => {
        const p: Point = { t: Math.round(t.elapsedSec), count: t.second.count, ok: t.second.ok, err: t.second.err, avg: t.second.avg, p50: t.second.p50, p95: t.second.p95, p99: t.second.p99, vus: t.vus, bytesIn: t.second.bytesIn }
        return prev.length && prev[prev.length - 1].t === p.t ? [...prev.slice(0, -1), p] : [...prev, p]
      })
    },
    onStatus: (s) => {
      setStatus(s.status)
      if (s.status !== 'running' && s.status !== 'stopping') {
        void queryClient.invalidateQueries({ queryKey: keys.run(run.id) })
        void queryClient.invalidateQueries({ queryKey: keys.activeRun })
        if (s.status === 'finished') toast.success('Run finished')
      }
    },
    onReconnect: () => void queryClient.invalidateQueries({ queryKey: keys.timeseries(run.id) }),
  })

  const stop = useMutation({
    mutationFn: () => api<void>('POST', `/runs/${run.id}/stop`),
    onSuccess: () => {
      setStatus('stopping')
      setStopping(false)
    },
    onError: (e) => toast.error(errorMessage(e)),
  })

  const total = tick?.total ?? run.summary?.total
  const recent = live ? tick?.recent5s : undefined
  const keyStats = tick?.keys ?? run.summary?.keys ?? []
  const codes = tick?.codes ?? run.summary?.codes ?? {}
  const planned = run.load.stages.reduce((s, x) => s + x.durationSec, 0)
  const elapsed = tick?.elapsedSec ?? run.summary?.elapsedSec ?? 0

  const points = series.data ?? NO_POINTS
  const chart = useMemo(() => {
    const xs = points.map((p) => p.t)
    const lat = (f: (p: Point) => number) => points.map((p) => (p.count - p.err > 0 || p.avg > 0 ? f(p) : null))
    return {
      rps: [xs, points.map((p) => p.count)] as [number[], number[]],
      err: [xs, points.map((p) => p.err)] as [number[], number[]],
      vus: [xs, points.map((p) => p.vus)] as [number[], number[]],
      lat: [xs, lat((p) => p.p50), lat((p) => p.p95), lat((p) => p.p99)] as [number[], (number | null)[], (number | null)[], (number | null)[]],
    }
  }, [points])
  const xMax = live ? Math.max(planned, Math.ceil(elapsed)) : undefined

  return (
    <div className="grid gap-8">
      <header className="grid gap-2">
        <nav className="text-sm text-muted-foreground">
          <Link to="/projects" className="hover:text-foreground">
            Projects
          </Link>
          {project.data && (
            <>
              {' / '}
              <Link to={`/projects/${project.data.id}`} className="hover:text-foreground">
                {project.data.name}
              </Link>
            </>
          )}
          {' / '}
          {run.testId ? (
            <Link to={`/tests/${run.testId}`} className="hover:text-foreground">
              {run.testName}
            </Link>
          ) : (
            run.testName
          )}
          {' / '}Run #{run.id}
        </nav>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{run.testName}</h1>
          <RunStatus run={{ status, verdict: run.verdict }} />
          {!live && <span className="text-sm text-muted-foreground">ran for <span className="font-mono tabular-nums">{formatElapsed(elapsed)}</span></span>}
          <div className="ml-auto flex gap-2">
            {live && me?.can.run && (
              <Button variant="outline" disabled={status === 'stopping' || stop.isPending} onClick={() => setStopping(true)}>
                <SquareIcon />
                {status === 'stopping' ? 'Stopping' : 'Stop'}
              </Button>
            )}
            {!live && <ExportMenu runId={run.id} />}
            {!live && me?.can.edit && (
              <Button variant="outline" size="sm" aria-label="Delete run" onClick={() => setDeleting(true)}>
                <Trash2Icon />
              </Button>
            )}
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          Started {formatDate(run.startedAt)} by {run.createdBy}
          {run.environment && ` against ${run.environment}`}
          {run.endReason && `. Ended: ${run.endReason}`}
        </p>
        {live && (
          <div className="mt-1 grid gap-1" aria-label="Progress">
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary transition-[width] duration-1000 ease-linear" style={{ width: `${Math.min(100, (elapsed / Math.max(planned, 1)) * 100)}%` }} />
            </div>
            <p className="font-mono text-xs text-muted-foreground tabular-nums">
              {formatElapsed(elapsed)} of {formatElapsed(planned)}
            </p>
          </div>
        )}
      </header>

      <Headline total={total} live={live} status={status} verdict={run.verdict} />
      {run.summary?.thresholds && run.summary.thresholds.length > 0 && <ThresholdsBlock results={run.summary.thresholds} />}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="errors">Failures{total && total.err > 0 ? ` (${formatNumber(total.err)})` : ''}</TabsTrigger>
          <TabsTrigger value="logs">Request log</TabsTrigger>
          <TabsTrigger value="summary">Details</TabsTrigger>
        </TabsList>
        <TabsContent value="errors" className="mt-6">
          <ErrorsTab runId={run.id} keys={run.keys} live={live} onShowLogs={(category, key) => showLogs({ category, key: String(key) })} />
        </TabsContent>
        <TabsContent value="logs" className="mt-6">
          <LogsTab runId={run.id} keys={run.keys} filters={filters} onFilters={setFilters} dropped={tick?.droppedLogs ?? run.summary?.droppedLogs ?? 0} />
        </TabsContent>
        <TabsContent value="summary" className="mt-6">
          <SummaryTab runId={run.id} keys={run.keys} live={live} total={total} />
        </TabsContent>
        <TabsContent value="overview" className="mt-6 grid gap-8">
      <section aria-label="Totals" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Requests per second"
          help={glossary.rps}
          value={total ? formatNumber(live && recent ? recent.rps : total.rps, 0) : '-'}
          sub={total ? (live ? `average ${formatNumber(total.rps, 0)} since the start` : `${formatNumber(total.count)} requests in total`) : undefined}
        />
        <StatCard
          label="Response time"
          help="Average time from sending a request until its full response arrived. The second line shows the time 95% of requests stayed under."
          value={total ? `${formatNumber(total.avg, 1)} ms` : '-'}
          sub={total ? `95% within ${formatNumber(total.p95, 1)} ms, 99% within ${formatNumber(total.p99, 1)} ms` : undefined}
        />
        <StatCard
          label="Failed requests"
          help={glossary.failed}
          value={total && total.count > 0 ? `${formatNumber((total.err / total.count) * 100, 2)}%` : '-'}
          sub={total ? `${formatNumber(total.err)} of ${formatNumber(total.count)}` : undefined}
          alert={!!total && total.err > 0}
        />
        <StatCard
          label="Simulated users"
          help={glossary.users}
          value={live && tick ? formatNumber(tick.vus) : formatNumber(Math.max(0, ...points.map((p) => p.vus)))}
          sub={live && tick ? `heading for ${tick.targetVus}` : 'at the peak'}
        />
      </section>

      <section aria-label="Status codes" className="grid gap-2">
        <h2 className="text-sm font-medium">
          Responses by status
          <HelpIcon label="responses by status" help={glossary.status} />
        </h2>
        <Codes codes={codes} />
        {total && total.bytesIn > 0 && (
          <p className="text-xs text-muted-foreground">
            Received {formatBytes(total.bytesIn)}, sent {formatBytes(total.bytesOut)}.
          </p>
        )}
      </section>

      <section aria-label="Charts" className="grid gap-8 lg:grid-cols-2">
        <TimeChart title="Requests per second" onPick={(x) => showLogs({ from: String(x), to: String(x) })} data={chart.rps} series={RPS} digits={0} xMax={xMax} live={live} />
        <TimeChart title="Response time" onPick={(x) => showLogs({ from: String(x), to: String(x) })} data={chart.lat} series={LATENCY} unit=" ms" xMax={xMax} live={live} />
        <TimeChart title="Failed requests per second" onPick={(x) => showLogs({ from: String(x), to: String(x), category: 'error' })} data={chart.err} series={ERRORS} digits={0} xMax={xMax} live={live} />
        <TimeChart title="Simulated users" onPick={(x) => showLogs({ from: String(x), to: String(x) })} data={chart.vus} series={VUS} digits={0} xMax={xMax} live={live} height={160} />
      </section>

      <section aria-label="Endpoints" className="grid gap-3">
        <h2 className="text-lg font-medium">By request</h2>
        <EndpointTable keys={run.keys} stats={keyStats} total={total} />
      </section>


        </TabsContent>
      </Tabs>

      <ConfirmDelete
        target={deleting ? run : null}
        title={`Delete run #${run.id}?`}
        description="Its metrics and logged requests are removed. This cannot be undone."
        confirm="Delete run"
        pending={remove.isPending}
        onConfirm={() => remove.mutate()}
        onCancel={() => setDeleting(false)}
      />
      <ConfirmDelete
        target={stopping ? run : null}
        title="Stop this run?"
        description="Requests in flight are cancelled and not counted. Results so far are kept."
        confirm="Stop run"
        pending={stop.isPending}
        onConfirm={() => stop.mutate()}
        onCancel={() => setStopping(false)}
      />
    </div>
  )
}

/** One sentence that answers "how did it go?" before any number needs reading. */
function Headline({ total, live, status, verdict }: { total?: Stats; live: boolean; status: string; verdict: Run['verdict'] }) {
  if (!total || total.count === 0) {
    return (
      <p className="rounded-lg border px-4 py-3 text-sm text-muted-foreground">
        {live ? 'Starting. The first results appear within a second.' : 'No requests were completed in this run.'}
      </p>
    )
  }
  const rate = (total.err / total.count) * 100
  const ruleFailed = status === 'finished' && verdict === 'fail'
  // Three honest levels: nothing failed, a few failed (under 1%), a real problem (or a broken rule).
  const level = ruleFailed ? 'bad' : total.err === 0 ? 'good' : rate < 1 ? 'some' : 'bad'
  const stopped = !live && status !== 'finished'
  const title = {
    good: live ? 'Running smoothly, nothing failed so far' : stopped ? 'Stopped early, nothing failed' : 'Finished, nothing failed',
    some: live ? 'Running, a few requests are failing' : stopped ? 'Stopped early, a few requests failed' : 'Finished, a few requests failed',
    bad: live
      ? 'Many requests are failing'
      : stopped
        ? 'Stopped early, many requests failed'
        : ruleFailed && total.err === 0
          ? 'Finished, but a pass/fail rule failed'
          : 'Finished, many requests failed',
  }[level]
  return (
    <div
      className={cn(
        'rounded-lg border px-4 py-3',
        level === 'good' && 'border-primary/30 bg-primary/5',
        level === 'bad' && 'border-destructive/40 bg-destructive/5',
      )}
    >
      <p className={cn('font-medium', level === 'good' && 'text-primary', level === 'bad' && 'text-destructive')}>{title}</p>
      <p className="mt-0.5 text-sm">
        {live ? 'So far ' : ''}
        {formatNumber(total.count)} requests
        {total.err === 0 ? ', none failed' : <>, <span className="text-destructive">{formatNumber(rate, rate < 1 ? 2 : 1)}% failed</span></>}. Half were answered within{' '}
        {formatNumber(total.p50, 1)} ms and 95% within {formatNumber(total.p95, 1)} ms, at about {formatNumber(total.rps, 0)} requests per second.
        {total.err > 0 && ' The Failures tab shows what went wrong.'}
        {ruleFailed && ' A pass/fail rule broke, see below.'}
      </p>
    </div>
  )
}

/** Compact list of the test's pass/fail rules with their outcome, shown once the run has a verdict. */
function ThresholdsBlock({ results }: { results: ThresholdResult[] }) {
  const broken = results.filter((r) => !r.passed).length
  return (
    <div className="grid gap-2 rounded-lg border px-4 py-3">
      <p className="text-sm font-medium">
        Pass/fail rules{' '}
        {broken > 0 ? (
          <span className="text-destructive">
            Failed: {broken} of {results.length} rule{results.length === 1 ? '' : 's'} broken
          </span>
        ) : (
          <span className="font-normal text-muted-foreground">all {results.length} passed</span>
        )}
      </p>
      <ul className="grid gap-1.5">
        {results.map((r, i) => (
          <li key={i} className="flex items-start gap-2 text-sm">
            {r.passed ? <CircleCheckIcon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" /> : <CircleXIcon className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />}
            <span className={cn(!r.passed && 'text-destructive')}>{resultSentence(r)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function StatCard({ label, help, value, sub, alert }: { label: string; help: string; value: string; sub?: string; alert?: boolean }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        {label}
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" aria-label={`About ${label}`} className="text-muted-foreground/70 hover:text-foreground">
              <CircleHelpIcon className="size-3" />
            </button>
          </TooltipTrigger>
          <TooltipContent className="max-w-60">{help}</TooltipContent>
        </Tooltip>
      </div>
      <p className={cn('mt-1 font-mono text-xl font-semibold tabular-nums', alert && 'text-destructive')}>{value}</p>
      <p className="mt-0.5 min-h-4 text-xs text-muted-foreground tabular-nums">{sub}</p>
    </div>
  )
}

type KeySort = 'name' | 'count' | 'err' | 'avg' | 'p95' | 'p99' | 'rps'

/**
 * One row per request, plus a total row whose meaning the viewer picks: all requests
 * combined (weighted, the default), or a statistic over the rows (sum, mean, median, max, min).
 */
function EndpointTable({ keys: runKeys, stats, total }: { keys: RunKey[]; stats: { keyId: number; total: Stats }[]; total?: Stats }) {
  const [sort, setSort] = useState<SortState<KeySort>>({ key: 'count', dir: 'desc' })
  const [mode, setMode] = useState<AggMode>(savedAggMode)
  const byId = new Map(stats.map((s) => [s.keyId, s.total]))
  const rows = sortRows(runKeys, sort, (k, key) => {
    const st = byId.get(k.keyId)
    if (key === 'name') return keyLabel(k)
    if (!st) return null
    return key === 'err' ? (st.count ? st.err / st.count : 0) : st[key]
  })
  const present = runKeys.map((k) => byId.get(k.keyId)).filter((s): s is Stats => !!s)
  const slowest = Math.max(...present.map((s) => s.avg), 0.001)
  const agg = aggregateRow(present, mode, total)
  const aggPct = mode === 'combined' || mode === 'sum' || !agg ? undefined : aggregate(present.map((x) => (x.count ? (x.err / x.count) * 100 : 0)), mode)
  const head = (label: string, key: KeySort, help?: string, right = true) => <SortButton label={label} sortKey={key} sort={sort} onSort={setSort} help={help} align={right ? 'right' : 'left'} />
  const pick = (m: AggMode) => {
    setMode(m)
    saveAggMode(m)
  }

  return (
    <div className="grid gap-2">
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader className="bg-muted/40">
            <TableRow className="hover:bg-transparent">
              <TableHead className="min-w-56">{head('Request', 'name', undefined, false)}</TableHead>
              <TableHead className="text-right">{head('Sent', 'count', glossary.sent)}</TableHead>
              <TableHead className="text-right">{head('Failed', 'err', glossary.failed)}</TableHead>
              <TableHead className="min-w-36 text-right">{head('Average, ms', 'avg', glossary.avg)}</TableHead>
              <TableHead className="text-right">{head('95% within, ms', 'p95', glossary.p95)}</TableHead>
              <TableHead className="text-right">{head('99% within, ms', 'p99', glossary.p99)}</TableHead>
              <TableHead className="text-right">{head('Per second', 'rps', glossary.rps)}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className="font-mono text-sm tabular-nums">
            {rows.map((k) => {
              const s = byId.get(k.keyId)
              return (
                <TableRow key={k.keyId}>
                  <TableCell className="font-sans">
                    <span className="mr-2 inline-block w-14 rounded border px-1.5 py-0.5 text-center font-mono text-[11px] text-muted-foreground">{k.method}</span>
                    {keyLabel(k)}
                  </TableCell>
                  <NumberCells s={s} slowest={slowest} />
                </TableRow>
              )
            })}
          </TableBody>
          {runKeys.length > 1 && agg && (
            <tfoot className="border-t-2 bg-muted/40 font-mono text-sm font-semibold tabular-nums">
              <TableRow className="hover:bg-muted/40">
                <TableCell className="font-sans">
                  <AggPicker value={mode} onChange={pick} />
                </TableCell>
                <NumberCells s={agg} slowest={0} pct={aggPct} />
              </TableRow>
            </tfoot>
          )}
        </Table>
      </div>
      {runKeys.length > 1 && <AggNote value={mode} />}
    </div>
  )
}

/** Sent, failed (count and share), times and rate. A thin bar under the average marks slow requests. */
function NumberCells({ s, slowest, pct: pctOverride }: { s?: Stats; slowest: number; pct?: number }) {
  if (!s) return <TableCell colSpan={6} className="text-muted-foreground">no responses yet</TableCell>
  const pct = pctOverride ?? (s.count ? (s.err / s.count) * 100 : 0)
  return (
    <>
      <TableCell className="text-right">{formatNumber(s.count, Number.isInteger(s.count) ? 0 : 1)}</TableCell>
      <TableCell className="text-right">
        <span className={cn(s.err > 0 && 'text-destructive')}>{formatNumber(s.err, Number.isInteger(s.err) ? 0 : 1)}</span>
        <span className={cn('ml-1.5 text-xs', s.err > 0 ? 'text-destructive/80' : 'text-muted-foreground')}>{formatNumber(pct, pct > 0 && pct < 1 ? 2 : 1)}%</span>
      </TableCell>
      <TableCell className="text-right">
        {formatNumber(s.avg, 1)}
        {slowest > 0 && s.avg / slowest >= 0.04 && (
          <span className="mt-1 ml-auto block h-0.5 rounded-full bg-primary/60" style={{ width: `${(s.avg / slowest) * 100}%` }} aria-hidden="true" />
        )}
      </TableCell>
      <TableCell className="text-right">{formatNumber(s.p95, 1)}</TableCell>
      <TableCell className="text-right">{formatNumber(s.p99, 1)}</TableCell>
      <TableCell className="text-right">{formatNumber(s.rps, 1)}</TableCell>
    </>
  )
}

/** The total row's numbers for the chosen mode. */
function aggregateRow(rows: Stats[], mode: AggMode, total?: Stats): Stats | undefined {
  if (mode === 'combined') return total
  if (rows.length === 0) return undefined
  const col = (f: (s: Stats) => number) => aggregate(rows.map(f), mode)
  const count = col((s) => s.count)
  const err = col((s) => s.err) // the failure share is aggregated separately by the caller
  return {
    count,
    ok: count - err,
    err,
    avg: col((s) => s.avg),
    min: col((s) => s.min),
    max: col((s) => s.max),
    p50: col((s) => s.p50),
    p90: col((s) => s.p90),
    p95: col((s) => s.p95),
    p99: col((s) => s.p99),
    rps: col((s) => s.rps),
    bytesIn: col((s) => s.bytesIn),
    bytesOut: col((s) => s.bytesOut),
  }
}

function Codes({ codes }: { codes: Record<string, number> }) {
  const statuses = Object.entries(codes).filter(([k]) => /^\d+$/.test(k)).sort(([a], [b]) => Number(a) - Number(b))
  const errors = Object.entries(codes).filter(([k]) => !/^\d+$/.test(k) && !k.startsWith('http_'))
  if (!statuses.length && !errors.length) return <p className="text-sm text-muted-foreground">No responses yet.</p>
  return (
    <dl className="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-2">
      {statuses.map(([code, n]) => (
        <div key={code} className="flex items-baseline justify-between rounded-md border px-3 py-2">
          <dt className={cn('font-mono text-sm', Number(code) >= 400 && 'text-destructive')}>
            <Help help={`${statusText[code] ?? 'HTTP status'}. ${Number(code) >= 400 ? 'Counts as failed.' : 'Counts as success.'}`}>HTTP {code}</Help>
          </dt>
          <dd className="font-mono text-sm tabular-nums">{formatNumber(n)}</dd>
        </div>
      ))}
      {errors.map(([cat, n]) => (
        <div key={cat} className="flex items-baseline justify-between rounded-md border px-3 py-2">
          <dt className="text-sm text-destructive">{categoryLabel[cat] ?? cat}</dt>
          <dd className="font-mono text-sm tabular-nums">{formatNumber(n)}</dd>
        </div>
      ))}
    </dl>
  )
}
