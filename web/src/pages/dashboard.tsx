import { useQuery } from '@tanstack/react-query'
import { ActivityIcon, FolderIcon } from 'lucide-react'
import { Link } from 'react-router'
import { api, errorMessage } from '@/api/client'
import type { Dashboard, DashboardStat } from '@/api/types'
import { EmptyState, PageHeader } from '@/components/page'
import { RunStatus, RunTable } from '@/components/run-table'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { formatElapsed, formatNumber } from '@/lib/format'

export function DashboardPage() {
  const dash = useQuery({ queryKey: ['dashboard'], queryFn: () => api<Dashboard>('GET', '/dashboard'), refetchInterval: 3000 })
  if (dash.isPending) return <Skeleton className="h-64 max-w-6xl" />
  if (dash.isError) return <p className="text-sm text-destructive">{errorMessage(dash.error)}</p>
  const d = dash.data
  const live = d.active?.live

  return (
    <div className="grid max-w-6xl gap-8">
      <PageHeader title="Dashboard" />
      {d.active && (
        <Link to={`/runs/${d.active.id}`} className="grid gap-4 rounded-lg border border-primary/40 bg-primary/5 p-5 transition-colors hover:bg-primary/10">
          <div className="flex flex-wrap items-center gap-3">
            <ActivityIcon className="size-5 text-primary" />
            <span className="font-medium">{d.active.testName}</span>
            <RunStatus run={d.active} />
            <span className="font-mono text-sm text-muted-foreground tabular-nums">{formatElapsed(live?.elapsedSec ?? 0)}</span>
            <span className="ml-auto text-sm text-primary">Open live view</span>
          </div>
          {live && (
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Tile label="Requests/s (last 5s)" value={formatNumber(live.recent5s.rps, 1)} />
              <Tile label="Avg latency" value={`${formatNumber(live.recent5s.avg, 1)} ms`} />
              <Tile label="Errors" value={formatNumber(live.total.err)} alert={live.total.err > 0} />
              <Tile label="Virtual users" value={`${live.vus} / ${live.targetVus}`} />
            </dl>
          )}
        </Link>
      )}

      <section aria-label="Totals" className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Runs today" value={formatNumber(d.today.runs)} />
        <Stat label="Pass rate, 7 days" value={d.week.finished ? `${formatNumber(d.week.passRate * 100, 0)}%` : '-'} sub={passSub(d.week)} />
        <Stat label="Requests, 7 days" value={formatNumber(d.week.requests)} />
        <Stat label="Error rate, 7 days" value={d.week.requests ? `${formatNumber((d.week.errors / d.week.requests) * 100, 2)}%` : '-'} />
      </section>

      <section className="grid gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">Recent runs</h2>
          {d.recent.length > 0 && (
            <Button variant="ghost" size="sm" asChild>
              <Link to="/runs">All runs</Link>
            </Button>
          )}
        </div>
        {d.recent.length === 0 ? (
          <EmptyState
            icon={<FolderIcon />}
            title="No runs yet"
            action={
              <Button asChild>
                <Link to="/projects">Open projects</Link>
              </Button>
            }
          >
            Create a project, add an environment and a test, then press Start. Live results appear here.
          </EmptyState>
        ) : (
          <RunTable runs={d.recent} />
        )}
      </section>
    </div>
  )
}

function passSub(s: DashboardStat) {
  return s.finished ? `${s.passed} of ${s.finished} finished runs` : 'No finished runs'
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-mono text-2xl font-semibold tabular-nums">{value}</p>
      <p className="mt-0.5 min-h-4 text-xs text-muted-foreground">{sub}</p>
    </div>
  )
}

function Tile({ label, value, alert }: { label: string; value: string; alert?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={`mt-0.5 font-mono text-lg font-semibold tabular-nums ${alert ? 'text-destructive' : ''}`}>{value}</dd>
    </div>
  )
}
