import { useInfiniteQuery } from '@tanstack/react-query'
import { HistoryIcon } from 'lucide-react'
import { Link, useSearchParams } from 'react-router'
import { api, errorMessage } from '@/api/client'
import type { Run } from '@/api/types'
import { EmptyState, PageHeader } from '@/components/page'
import { RunTable } from '@/components/run-table'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'

const PAGE = 50

export function RunsPage() {
  const [params, setParams] = useSearchParams()
  const status = params.get('status') ?? ''
  const testId = params.get('testId') ?? ''
  const runs = useInfiniteQuery({
    queryKey: ['runs', 'history', status, testId],
    queryFn: ({ pageParam }) => api<Run[]>('GET', `/runs?limit=${PAGE}&status=${status}&testId=${testId}&before=${pageParam}`),
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

  return (
    <div className="max-w-6xl">
      <PageHeader title="Runs" description="Every run, newest first. Open one to see its charts, errors and logged requests." />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="grid gap-2">
          <Label htmlFor="runs-status">Result</Label>
          <Select value={status || 'all'} onValueChange={(v) => set('status', v === 'all' ? '' : v)}>
            <SelectTrigger id="runs-status" className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any result</SelectItem>
              <SelectItem value="finished">Finished</SelectItem>
              <SelectItem value="aborted">Stopped</SelectItem>
              <SelectItem value="failed">Error</SelectItem>
              <SelectItem value="running">Running</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {testId && (
          <Button variant="ghost" onClick={() => set('testId', '')}>
            Show all tests
          </Button>
        )}
      </div>
      {runs.isPending ? (
        <Skeleton className="h-64" />
      ) : runs.isError ? (
        <p className="text-sm text-destructive">{errorMessage(runs.error)}</p>
      ) : rows.length === 0 ? (
        <EmptyState icon={<HistoryIcon />} title="No runs yet" action={<Button variant="outline" asChild><Link to="/projects">Go to projects</Link></Button>}>
          {status || testId ? 'No runs match this filter.' : 'Start a test from its builder page. Its results appear here.'}
        </EmptyState>
      ) : (
        <RunTable runs={rows} />
      )}
      {runs.hasNextPage && (
        <Button variant="outline" className="mt-4" onClick={() => void runs.fetchNextPage()} disabled={runs.isFetchingNextPage}>
          {runs.isFetchingNextPage ? 'Loading' : 'Load more'}
        </Button>
      )}
    </div>
  )
}
