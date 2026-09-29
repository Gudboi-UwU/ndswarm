import { useQuery } from '@tanstack/react-query'
import { ActivityIcon, PlusIcon } from 'lucide-react'
import { useState } from 'react'
import { useMe } from '@/api/auth'
import { NewTestDialog } from '@/components/new-test-dialog'
import { HelpIcon } from '@/components/table-help'
import { glossary } from '@/lib/glossary'
import { Link } from 'react-router'
import { api, errorMessage } from '@/api/client'
import type { Dashboard, DashboardStat } from '@/api/types'
import { PageHeader } from '@/components/page'
import { RunStatus, RunTable } from '@/components/run-table'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { formatElapsed, formatNumber } from '@/lib/format'

export function DashboardPage() {
  const dash = useQuery({ queryKey: ['dashboard'], queryFn: () => api<Dashboard>('GET', '/dashboard'), refetchInterval: 3000 })
  const { data: me } = useMe()
  const [creating, setCreating] = useState(false)
  if (dash.isPending) return <Skeleton className="h-64 max-w-6xl" />
  if (dash.isError) return <p className="text-sm text-destructive">{errorMessage(dash.error)}</p>
  const d = dash.data
  const live = d.active?.live

  return (
    <div className="grid max-w-6xl gap-8">
      <PageHeader
        title="Home"
        actions={
          (d.recent.length > 0 || d.active) && (
            <>
              <Button variant="outline" asChild>
                <Link to="/projects">Projects</Link>
              </Button>
              {me?.can.edit && (
                <Button onClick={() => setCreating(true)}>
                  <PlusIcon />
                  New test
                </Button>
              )}
            </>
          )
        }
      />
      {d.recent.length === 0 && !d.active && <GettingStarted canEdit={!!me?.can.edit} onNew={() => setCreating(true)} />}
      {creating && <NewTestDialog open={creating} onOpenChange={setCreating} />}
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
              <Tile label="Requests per second" value={formatNumber(live.recent5s.rps, 1)} />
              <Tile label="Average response time" value={`${formatNumber(live.recent5s.avg, 1)} ms`} />
              <Tile label="Failed requests" value={formatNumber(live.total.err)} alert={live.total.err > 0} />
              <Tile label="Simulated users" value={`${live.vus} / ${live.targetVus}`} />
            </dl>
          )}
        </Link>
      )}

      {d.recent.length > 0 && (
      <section aria-label="Totals" className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Runs today" help="Runs started since midnight." value={formatNumber(d.today.runs)} />
        <Stat label="Runs passed, last 7 days" help={glossary.result} value={d.week.finished ? `${formatNumber(d.week.passRate * 100, 0)}%` : '-'} sub={passSub(d.week)} />
        <Stat label="Requests, last 7 days" help={glossary.requests} value={formatNumber(d.week.requests)} />
        <Stat label="Failed requests, last 7 days" help={glossary.failed} value={d.week.requests ? `${formatNumber((d.week.errors / d.week.requests) * 100, 2)}%` : '-'} />
      </section>
      )}

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
          <p className="text-sm text-muted-foreground">Finished runs appear here.</p>        ) : (
          <RunTable runs={d.recent} />
        )}
      </section>
    </div>
  )
}

const steps = [
  { title: 'Describe the requests', body: 'Name the test, enter the server address and the requests to send. Random data such as emails or ids is one click away.' },
  { title: 'Choose the load', body: 'How many simulated users send those requests at the same time, and for how long.' },
  { title: 'Run and read the results', body: 'Watch requests per second, response times and failures live, then see what failed and why.' },
]

function GettingStarted({ canEdit, onNew }: { canEdit: boolean; onNew: () => void }) {
  return (
    <section className="grid gap-6 rounded-lg border p-6">
      <div>
        <h2 className="text-lg font-medium">Load test an API in three steps</h2>
        <p className="mt-1 text-sm text-muted-foreground">Find out how many requests your server handles, how fast it answers, and when it starts to fail.</p>
      </div>
      <ol className="grid gap-4 md:grid-cols-3">
        {steps.map((s, i) => (
          <li key={s.title} className="grid content-start gap-1">
            <span className="grid size-7 place-items-center rounded-full bg-primary/15 font-mono text-sm font-semibold text-primary">{i + 1}</span>
            <span className="mt-1 font-medium">{s.title}</span>
            <span className="text-sm text-muted-foreground">{s.body}</span>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-3">
        {canEdit && (
          <Button onClick={onNew}>
            <PlusIcon />
            Create a test
          </Button>
        )}
        <Button variant="outline" asChild>
          <Link to="/projects">Browse projects</Link>
        </Button>
      </div>
    </section>
  )
}

function passSub(s: DashboardStat) {
  return s.finished ? `${s.passed} of ${s.finished} finished runs` : 'No finished runs'
}

function Stat({ label, help, value, sub }: { label: string; help: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border p-4">
      <p className="text-xs text-muted-foreground">
        {label}
        <HelpIcon label={label} help={help} />
      </p>
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
