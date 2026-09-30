import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { HistoryIcon } from 'lucide-react'
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { api, errorMessage } from '@/api/client'
import { keys } from '@/api/keys'
import type { Project, Run } from '@/api/types'
import { EmptyState } from '@/components/page'
import { Help, SortButton } from '@/components/table-help'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatDate, formatElapsed, formatNumber } from '@/lib/format'
import { glossary } from '@/lib/glossary'
import { sortRows, type SortState } from '@/lib/sort'
import { cn } from '@/lib/utils'

export function RunStatus({ run, rulesCount = 0 }: { run: Pick<Run, 'status' | 'verdict'>; rulesCount?: number }) {
  if (run.status === 'finished') {
    if (run.verdict === 'fail')
      return (
        <Badge variant="destructive" title="A pass/fail rule of this test was broken.">
          Failed
        </Badge>
      )
    if (rulesCount > 0) return <Badge title="Every pass/fail rule of this test held.">Passed</Badge>
    return (
      <Badge variant="secondary" title="No pass/fail rules are set. Check the failed requests.">
        Finished
      </Badge>
    )
  }
  const label: Record<string, string> = { running: 'Running', stopping: 'Stopping', aborted: 'Stopped', failed: 'Error' }
  return <Badge variant={run.status === 'failed' ? 'destructive' : run.status === 'running' ? 'default' : 'secondary'}>{label[run.status] ?? run.status}</Badge>
}

type SortKey = 'id' | 'test' | 'started' | 'duration' | 'requests' | 'avg' | 'p95' | 'failed'

function sortValue(r: Run, k: SortKey): number | string | null {
  const t = r.summary?.total
  switch (k) {
    case 'id':
      return r.id
    case 'test':
      return r.testName
    case 'started':
      return r.startedAt
    case 'duration':
      return r.summary?.elapsedSec ?? null
    case 'requests':
      return t?.count ?? null
    case 'avg':
      return t?.avg ?? null
    case 'p95':
      return t?.p95 ?? null
    case 'failed':
      return t && t.count ? t.err / t.count : null
  }
}

/** Runs with their headline numbers. Click a column title's arrow to sort. */
export function RunTable({ runs, showTest = true, sort, onSort }: { runs: Run[]; showTest?: boolean; sort?: SortState<SortKey>; onSort?: (s: SortState<SortKey>) => void }) {
  const [own, setOwn] = useState<SortState<SortKey>>({ key: 'id', dir: 'desc' })
  const s = sort ?? own
  const set = onSort ?? setOwn
  const rows = sortRows(runs, s, sortValue)
  const head = (label: string, key: SortKey, help?: string, right = true) => (
    <SortButton label={label} sortKey={key} sort={s} onSort={set} help={help} align={right ? 'right' : 'left'} />
  )
  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader className="bg-muted/40">
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-20">{head('Run', 'id', undefined, false)}</TableHead>
            {showTest && <TableHead>{head('Test', 'test', undefined, false)}</TableHead>}
            <TableHead className="w-28">
              <Help help={glossary.result}>Result</Help>
            </TableHead>
            <TableHead className="hidden w-44 md:table-cell">{head('Started', 'started', undefined, false)}</TableHead>
            <TableHead className="w-28 text-right">{head('Duration', 'duration', glossary.duration)}</TableHead>
            <TableHead className="w-28 text-right">{head('Requests', 'requests', glossary.requests)}</TableHead>
            <TableHead className="w-28 text-right">{head('Average, ms', 'avg', glossary.avg)}</TableHead>
            <TableHead className="w-36 text-right">{head('95% within, ms', 'p95', glossary.p95)}</TableHead>
            <TableHead className="w-24 text-right">{head('Failed', 'failed', glossary.failedPct)}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody className="text-sm">
          {rows.map((r) => {
            const t = r.summary?.total
            const errPct = t && t.count ? (t.err / t.count) * 100 : 0
            return (
              <TableRow key={r.id} className="relative">
                <TableCell className="font-mono">
                  <Link to={`/runs/${r.id}`} className="after:absolute after:inset-0 hover:underline">
                    #{r.id}
                  </Link>
                </TableCell>
                {showTest && <TableCell className="font-medium">{r.testName}</TableCell>}
                <TableCell>
                  <RunStatus run={r} rulesCount={r.summary?.thresholds?.length ?? 0} />
                </TableCell>
                <TableCell className="hidden text-muted-foreground md:table-cell">{formatDate(r.startedAt)}</TableCell>
                <TableCell className="text-right font-mono tabular-nums">{formatElapsed(r.summary?.elapsedSec ?? 0)}</TableCell>
                <TableCell className="text-right font-mono tabular-nums">{t ? formatNumber(t.count) : '-'}</TableCell>
                <TableCell className="text-right font-mono tabular-nums">{t ? formatNumber(t.avg, 1) : '-'}</TableCell>
                <TableCell className="text-right font-mono tabular-nums">{t ? formatNumber(t.p95, 1) : '-'}</TableCell>
                <TableCell className={cn('text-right font-mono tabular-nums', errPct > 0 && 'text-destructive')}>{t ? `${formatNumber(errPct, 1)}%` : '-'}</TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}

const PAGE = 50

/**
 * Run history with filters (kept in the URL), optional grouping by project and sortable columns.
 * With projectId it shows one project's runs.
 */
export function RunsView({ projectId }: { projectId?: number }) {
  const [params, setParams] = useSearchParams()
  const result = params.get('result') ?? ''
  const project = projectId ? String(projectId) : (params.get('project') ?? '')
  const testId = params.get('testId') ?? ''
  const grouped = !projectId && params.get('group') !== 'off'
  const [sort, setSort] = useState<SortState<SortKey>>({ key: 'id', dir: 'desc' })
  const projects = useQuery({ queryKey: keys.projects, queryFn: () => api<Project[]>('GET', '/projects'), enabled: !projectId })
  const runs = useInfiniteQuery({
    queryKey: ['runs', 'history', result, project, testId],
    queryFn: ({ pageParam }) => api<Run[]>('GET', `/runs?limit=${PAGE}&result=${result}&projectId=${project}&testId=${testId}&before=${pageParam}`),
    initialPageParam: 0,
    getNextPageParam: (last) => (last.length === PAGE ? last[last.length - 1].id : undefined),
  })
  const rows = runs.data?.pages.flat() ?? []
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params)
    if (v) next.set(k, v)
    else next.delete(k)
    setParams(next, { replace: true })
  }
  const projectName = (id: number | null) => projects.data?.find((p) => p.id === id)?.name ?? 'Deleted project'
  const groups = new Map<number, Run[]>()
  for (const r of rows) {
    const k = r.projectId ?? 0
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k)!.push(r)
  }
  const filtered = !!(result || testId || (project && !projectId))

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end gap-3">
        {!projectId && (
          <div className="grid gap-2">
            <Label htmlFor="runs-project">Project</Label>
            <Select value={project || 'all'} onValueChange={(v) => set('project', v === 'all' ? '' : v)}>
              <SelectTrigger id="runs-project" className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All projects</SelectItem>
                {projects.data?.map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="grid gap-2">
          <Label htmlFor="runs-status">Result</Label>
          <Select value={result || 'all'} onValueChange={(v) => set('result', v === 'all' ? '' : v)}>
            <SelectTrigger id="runs-status" className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any result</SelectItem>
              <SelectItem value="passed">Passed</SelectItem>
              <SelectItem value="failed">Failed (rule broken)</SelectItem>
              <SelectItem value="norules">Finished without rules</SelectItem>
              <SelectItem value="aborted">Stopped</SelectItem>
              <SelectItem value="error">Error</SelectItem>
              <SelectItem value="running">Running</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {!projectId && (
          <label className="flex h-8 items-center gap-2 text-sm">
            <Switch checked={grouped} onCheckedChange={(on) => set('group', on ? '' : 'off')} />
            Group by project
          </label>
        )}
        {filtered && (
          <Button variant="ghost" onClick={() => setParams({}, { replace: true })}>
            Clear filters
          </Button>
        )}
      </div>

      {runs.isPending ? (
        <Skeleton className="h-64" />
      ) : runs.isError ? (
        <p className="text-sm text-destructive">{errorMessage(runs.error)}</p>
      ) : rows.length === 0 ? (
        <EmptyState icon={<HistoryIcon />} title={filtered ? 'No runs match' : 'No runs yet'}>
          {filtered ? 'Try another filter, or clear the filters.' : 'Open a test and press Run test. Every run is listed here with its results.'}
        </EmptyState>
      ) : grouped ? (
        <div className="grid gap-8">
          {[...groups].map(([pid, list]) => (
            <section key={pid} className="grid gap-2">
              <h2 className="flex items-baseline gap-2 text-sm font-medium">
                {pid ? (
                  <Link to={`/projects/${pid}`} className="hover:underline">
                    {projectName(pid)}
                  </Link>
                ) : (
                  'Deleted project'
                )}
                <span className="font-normal text-muted-foreground">
                  {list.length} run{list.length === 1 ? '' : 's'}
                </span>
              </h2>
              <RunTable runs={list} sort={sort} onSort={setSort} />
            </section>
          ))}
        </div>
      ) : (
        <RunTable runs={rows} sort={sort} onSort={setSort} />
      )}
      {runs.hasNextPage && (
        <div>
          <Button variant="outline" onClick={() => void runs.fetchNextPage()} disabled={runs.isFetchingNextPage}>
            {runs.isFetchingNextPage ? 'Loading' : 'Load older runs'}
          </Button>
        </div>
      )}
    </div>
  )
}
