import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CircleHelpIcon, SquareIcon } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router'
import { toast } from 'sonner'
import { useMe } from '@/api/auth'
import { api, ApiError, errorMessage } from '@/api/client'
import { keys } from '@/api/keys'
import type { Point, Run, RunKey, Stats, Tick } from '@/api/types'
import { useRunStream } from '@/api/ws'
import { ConfirmDelete } from '@/components/page'
import { TimeChart, type ChartSeries } from '@/components/time-chart'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { formatBytes, formatDate, formatElapsed, formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'
import { NotFoundPage } from './not-found'

// Latency percentiles are ordinal: one hue, darker = higher percentile (light) / brighter (dark).
// Validated with the dataviz palette checks against both surfaces.
const LATENCY: ChartSeries[] = [
  { label: 'p50', color: ['#10b981', '#047857'] },
  { label: 'p95', color: ['#047857', '#10b981'] },
  { label: 'p99', color: ['#022c22', '#6ee7b7'] },
]
const RPS: ChartSeries[] = [{ label: 'Requests/s', color: '--primary', fill: true }]
const ERRORS: ChartSeries[] = [{ label: 'Errors/s', color: '--destructive', fill: true }]
const NO_POINTS: Point[] = []
const VUS: ChartSeries[] = [{ label: 'Virtual users', color: '--muted-foreground' }]

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
          <StatusBadge status={status} verdict={run.verdict} />
          <span className="font-mono text-sm text-muted-foreground tabular-nums">
            {formatElapsed(elapsed)}
            {live && ` / ${formatElapsed(planned)}`}
          </span>
          {live && me?.can.run && (
            <Button variant="outline" className="ml-auto" disabled={status === 'stopping' || stop.isPending} onClick={() => setStopping(true)}>
              <SquareIcon />
              {status === 'stopping' ? 'Stopping' : 'Stop'}
            </Button>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          Started {formatDate(run.startedAt)} by {run.createdBy}
          {run.environment && ` against ${run.environment}`}
          {run.endReason && `. Ended: ${run.endReason}`}
        </p>
      </header>

      <section aria-label="Totals" className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
        <StatCard label="Avg latency" help="Mean time from sending a request until its response body was fully read." value={total ? `${formatNumber(total.avg, 1)} ms` : '-'} sub={recent && `${formatNumber(recent.avg, 1)} ms last 5s`} />
        <StatCard label="OK" help="Requests with no transport error and a status from 200 to 399." value={total ? formatNumber(total.ok) : '-'} sub={total && total.count > 0 ? `${formatNumber((total.ok / total.count) * 100, 1)}% of requests` : undefined} />
        <StatCard
          label="Errors"
          help="Timeouts, connection, DNS and TLS failures, HTTP 4xx and 5xx, and template errors."
          value={total ? formatNumber(total.err) : '-'}
          sub={total && total.count > 0 ? `${formatNumber((total.err / total.count) * 100, 2)}% error rate` : undefined}
          alert={!!total && total.err > 0}
        />
        <StatCard label="Requests/s" help="Completed requests per second, averaged since the start." value={total ? formatNumber(total.rps, 1) : '-'} sub={recent && `${formatNumber(recent.rps, 1)} last 5s`} />
        <StatCard label="Virtual users" help="Users sending requests right now, and the current stage target." value={tick && live ? formatNumber(tick.vus) : '-'} sub={tick && live ? `target ${tick.targetVus}` : undefined} />
        <StatCard label="p95" help="95% of requests finished within this time." value={total ? `${formatNumber(total.p95, 1)} ms` : '-'} sub={recent && `${formatNumber(recent.p95, 1)} ms last 5s`} />
        <StatCard label="p99" help="99% of requests finished within this time." value={total ? `${formatNumber(total.p99, 1)} ms` : '-'} sub={recent && `${formatNumber(recent.p99, 1)} ms last 5s`} />
      </section>

      <section aria-label="Charts" className="grid gap-8 lg:grid-cols-2">
        <TimeChart title="Requests per second" data={chart.rps} series={RPS} digits={0} xMax={xMax} />
        <TimeChart title="Latency" data={chart.lat} series={LATENCY} unit=" ms" xMax={xMax} />
        <TimeChart title="Errors per second" data={chart.err} series={ERRORS} digits={0} xMax={xMax} />
        <TimeChart title="Virtual users" data={chart.vus} series={VUS} digits={0} xMax={xMax} height={160} />
      </section>

      <section aria-label="Endpoints" className="grid gap-3">
        <h2 className="text-lg font-medium">Endpoints</h2>
        <EndpointTable keys={run.keys} stats={keyStats} />
      </section>

      <section aria-label="Status codes" className="grid gap-3">
        <h2 className="text-lg font-medium">Status codes and errors</h2>
        <Codes codes={codes} />
        {total && total.bytesIn > 0 && (
          <p className="text-sm text-muted-foreground">
            Received {formatBytes(total.bytesIn)}, sent {formatBytes(total.bytesOut)}.
          </p>
        )}
      </section>

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

function StatusBadge({ status, verdict }: { status: string; verdict: string | null }) {
  if (status === 'finished') {
    return <Badge variant={verdict === 'fail' ? 'destructive' : 'default'}>{verdict === 'fail' ? 'Failed thresholds' : 'Passed'}</Badge>
  }
  const label: Record<string, string> = { running: 'Running', stopping: 'Stopping', aborted: 'Stopped', failed: 'Failed' }
  return <Badge variant={status === 'failed' ? 'destructive' : status === 'running' ? 'default' : 'secondary'}>{label[status] ?? status}</Badge>
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

function keyLabel(k: RunKey): string {
  let s = k.flow
  if (k.step !== k.flow) s += ` / ${k.step}`
  if (k.variant) s += ` [${k.variant}]`
  return s
}

function EndpointTable({ keys: runKeys, stats }: { keys: RunKey[]; stats: { keyId: number; total: Stats }[] }) {
  const byId = new Map(stats.map((s) => [s.keyId, s.total]))
  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Endpoint</TableHead>
            <TableHead className="text-right">Requests</TableHead>
            <TableHead className="text-right">Errors</TableHead>
            <TableHead className="text-right">Avg</TableHead>
            <TableHead className="text-right">p95</TableHead>
            <TableHead className="text-right">p99</TableHead>
            <TableHead className="text-right">Req/s</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody className="font-mono text-sm tabular-nums">
          {runKeys.map((k) => {
            const s = byId.get(k.keyId)
            return (
              <TableRow key={k.keyId}>
                <TableCell className="font-sans">
                  <span className="mr-2 text-xs text-muted-foreground">{k.method}</span>
                  {keyLabel(k)}
                </TableCell>
                <TableCell className="text-right">{s ? formatNumber(s.count) : '-'}</TableCell>
                <TableCell className={cn('text-right', s && s.err > 0 && 'text-destructive')}>{s ? `${formatNumber(s.err)} (${formatNumber(s.count ? (s.err / s.count) * 100 : 0, 1)}%)` : '-'}</TableCell>
                <TableCell className="text-right">{s ? `${formatNumber(s.avg, 1)} ms` : '-'}</TableCell>
                <TableCell className="text-right">{s ? `${formatNumber(s.p95, 1)} ms` : '-'}</TableCell>
                <TableCell className="text-right">{s ? `${formatNumber(s.p99, 1)} ms` : '-'}</TableCell>
                <TableCell className="text-right">{s ? formatNumber(s.rps, 1) : '-'}</TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}

const categoryLabel: Record<string, string> = {
  http_4xx: 'HTTP 4xx',
  http_5xx: 'HTTP 5xx',
  timeout: 'Timeout',
  connection: 'Connection failed',
  dns: 'DNS lookup failed',
  tls: 'TLS failed',
  template: 'Template error',
}

function Codes({ codes }: { codes: Record<string, number> }) {
  const statuses = Object.entries(codes).filter(([k]) => /^\d+$/.test(k)).sort(([a], [b]) => Number(a) - Number(b))
  const errors = Object.entries(codes).filter(([k]) => !/^\d+$/.test(k) && !k.startsWith('http_'))
  if (!statuses.length && !errors.length) return <p className="text-sm text-muted-foreground">No responses yet.</p>
  return (
    <dl className="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-2">
      {statuses.map(([code, n]) => (
        <div key={code} className="flex items-baseline justify-between rounded-md border px-3 py-2">
          <dt className={cn('font-mono text-sm', Number(code) >= 400 && 'text-destructive')}>HTTP {code}</dt>
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
