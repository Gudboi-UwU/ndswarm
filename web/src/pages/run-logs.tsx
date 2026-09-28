import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { XIcon } from 'lucide-react'
import { useState } from 'react'
import { api, errorMessage } from '@/api/client'
import type { LogDetail, LogRow, RunKey } from '@/api/types'
import { Code, Waterfall } from '@/components/http-view'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatBytes, formatElapsed, formatNumber, headerText, pretty } from '@/lib/format'
import { categoryLabel, emptyFilters, keyLabel, type LogFilters } from '@/lib/run'
import { cn } from '@/lib/utils'

const reasonHelp: Record<string, string> = {
  error: 'Logged because it failed.',
  sample: 'A random sample of successful requests.',
  slowest: 'The slowest request of its endpoint in that second.',
}

/** Sampled request log with filters. Up to 50 errors, 20 samples and the slowest request are kept per endpoint per second. */
export function LogsTab({ runId, keys: runKeys, filters, onFilters, dropped }: { runId: number; keys: RunKey[]; filters: LogFilters; onFilters: (f: LogFilters) => void; dropped: number }) {
  const [open, setOpen] = useState<number | null>(null)
  const params = new URLSearchParams({ limit: '100' })
  for (const [k, v] of Object.entries(filters)) if (v) params.set(k, v)
  const logs = useInfiniteQuery({
    queryKey: ['run', runId, 'logs', params.toString()],
    queryFn: ({ pageParam }) => api<{ items: LogRow[]; next: number | null }>('GET', `/runs/${runId}/logs?${params}&cursor=${pageParam}`),
    initialPageParam: 0,
    getNextPageParam: (last) => last.next ?? undefined,
    placeholderData: keepPreviousData,
  })
  const rows = logs.data?.pages.flatMap((p) => p.items) ?? []
  const set = (patch: Partial<LogFilters>) => onFilters({ ...filters, ...patch })
  const active = Object.values(filters).some(Boolean)

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-2">
          <Label htmlFor="log-key">Endpoint</Label>
          <Select value={filters.key || 'all'} onValueChange={(v) => set({ key: v === 'all' ? '' : v })}>
            <SelectTrigger id="log-key" className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All endpoints</SelectItem>
              {runKeys.map((k) => (
                <SelectItem key={k.keyId} value={String(k.keyId)}>
                  {keyLabel(k)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="log-result">Result</Label>
          <Select value={filters.category || 'all'} onValueChange={(v) => set({ category: v === 'all' ? '' : v })}>
            <SelectTrigger id="log-result" className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any result</SelectItem>
              <SelectItem value="ok">OK only</SelectItem>
              <SelectItem value="error">Errors only</SelectItem>
              {Object.entries(categoryLabel).map(([k, v]) => (
                <SelectItem key={k} value={k}>
                  {v}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="log-reason">Why logged</Label>
          <Select value={filters.reason || 'all'} onValueChange={(v) => set({ reason: v === 'all' ? '' : v })}>
            <SelectTrigger id="log-reason" className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any reason</SelectItem>
              <SelectItem value="error">Error</SelectItem>
              <SelectItem value="sample">Sample</SelectItem>
              <SelectItem value="slowest">Slowest</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="log-min">Slower than (ms)</Label>
          <Input id="log-min" type="number" min={0} className="w-32 font-mono" value={filters.minMs} onChange={(e) => set({ minMs: e.target.value })} />
        </div>
        {(filters.from || filters.to) && (
          <Badge variant="secondary" className="h-8 gap-1 font-mono">
            {filters.from === filters.to ? `second ${formatElapsed(Number(filters.from))}` : `${formatElapsed(Number(filters.from || 0))} to ${filters.to ? formatElapsed(Number(filters.to)) : 'end'}`}
            <button type="button" aria-label="Clear time filter" onClick={() => set({ from: '', to: '' })}>
              <XIcon className="size-3" />
            </button>
          </Badge>
        )}
        {active && (
          <Button variant="ghost" onClick={() => onFilters(emptyFilters)}>
            Clear filters
          </Button>
        )}
      </div>
      <p className="text-sm text-muted-foreground">
        Per endpoint and second, ndswarm keeps up to 50 errors, 20 sampled successes and the slowest request.
        {dropped > 0 && ` ${formatNumber(dropped)} more requests qualified but were not stored.`} Click a point in a chart to see its second.
      </p>

      {logs.isPending ? (
        <Skeleton className="h-64" />
      ) : logs.isError ? (
        <p className="text-sm text-destructive">{errorMessage(logs.error)}</p>
      ) : rows.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">{active ? 'No logged requests match these filters.' : 'No requests logged yet.'}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-20">Time</TableHead>
                <TableHead>Endpoint</TableHead>
                <TableHead className="w-20">Status</TableHead>
                <TableHead className="w-28 text-right">Latency</TableHead>
                <TableHead className="w-16 text-right">VU</TableHead>
                <TableHead className="w-24">Logged as</TableHead>
                <TableHead>Error</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="text-sm">
              {rows.map((l) => (
                <TableRow key={l.id} className="cursor-pointer" onClick={() => setOpen(l.id)}>
                  <TableCell className="font-mono tabular-nums">{formatElapsed(l.sec)}</TableCell>
                  <TableCell>
                    <button type="button" className="text-left hover:underline" onClick={() => setOpen(l.id)}>
                      {keyLabel(runKeys.find((k) => k.keyId === l.keyId))}
                    </button>
                  </TableCell>
                  <TableCell className={cn('font-mono', l.category && 'text-destructive')}>{l.status || '-'}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{formatNumber(l.latencyMs, 1)} ms</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{l.vu}</TableCell>
                  <TableCell className="text-muted-foreground" title={reasonHelp[l.reason]}>
                    {l.reason}
                  </TableCell>
                  <TableCell className="max-w-80 truncate text-destructive">{l.error}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {logs.hasNextPage && (
        <div>
          <Button variant="outline" onClick={() => void logs.fetchNextPage()} disabled={logs.isFetchingNextPage}>
            {logs.isFetchingNextPage ? 'Loading' : 'Load more'}
          </Button>
        </div>
      )}
      <LogDetailDialog runId={runId} logId={open} keys={runKeys} onClose={() => setOpen(null)} />
    </div>
  )
}

/** One logged request: timing waterfall, then what was sent and received. */
export function LogDetailDialog({ runId, logId, keys: runKeys, onClose }: { runId: number; logId: number | null; keys: RunKey[]; onClose: () => void }) {
  const [tab, setTab] = useState<'response' | 'request'>('response')
  const detail = useQuery({
    queryKey: ['run', runId, 'log', logId],
    queryFn: () => api<LogDetail>('GET', `/runs/${runId}/logs/${logId}`),
    enabled: logId !== null,
  })
  const d = detail.data
  return (
    <Dialog open={logId !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{d ? keyLabel(runKeys.find((k) => k.keyId === d.keyId)) : 'Request'}</DialogTitle>
          <DialogDescription>
            {d && `At ${formatElapsed(d.sec)}, virtual user ${d.vu}, iteration ${d.iter}. ${reasonHelp[d.reason]}`}
          </DialogDescription>
        </DialogHeader>
        {detail.isPending ? (
          <Skeleton className="h-48" />
        ) : detail.isError ? (
          <p className="text-sm text-destructive">{errorMessage(detail.error)}</p>
        ) : (
          d && (
            <div className="grid gap-4">
              <div className="flex flex-wrap items-center gap-3">
                <Badge variant={d.category ? 'destructive' : 'default'} className="font-mono">
                  {d.status ? `HTTP ${d.status}` : 'No response'}
                </Badge>
                <span className="font-mono text-sm tabular-nums">{formatNumber(d.latencyMs, 1)} ms</span>
                {d.response && <span className="font-mono text-sm text-muted-foreground">{formatBytes(d.response.bodySize)}</span>}
                {d.category && <span className="text-sm text-destructive">{categoryLabel[d.category] ?? d.category}</span>}
              </div>
              {d.error && <p className="rounded-md bg-destructive/10 p-2 text-sm text-destructive">{d.error}</p>}
              {d.status > 0 && <Waterfall t={d.timing} />}
              <div className="flex gap-1 border-b" role="tablist">
                {(['response', 'request'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    role="tab"
                    aria-selected={tab === t}
                    onClick={() => setTab(t)}
                    className={cn('-mb-px border-b-2 px-3 py-1.5 text-sm', tab === t ? 'border-primary font-medium' : 'border-transparent text-muted-foreground')}
                  >
                    {t === 'response' ? 'Response' : 'Request'}
                  </button>
                ))}
              </div>
              {tab === 'response' &&
                (d.response ? (
                  <Code text={`${headerText(d.response.headers)}\n\n${pretty(d.response.body)}`} note={d.response.truncated ? 'Body cut at 64 KB.' : undefined} />
                ) : (
                  <p className="text-sm text-muted-foreground">No response was received.</p>
                ))}
              {tab === 'request' &&
                (d.request ? (
                  <Code text={`${d.request.method} ${d.request.url}\n${headerText(d.request.headers)}\n\n${pretty(d.request.body)}`} note={d.request.truncated ? 'Body cut at 16 KB.' : undefined} />
                ) : (
                  <p className="text-sm text-muted-foreground">The request could not be built from its template.</p>
                ))}
              <p className="text-xs text-muted-foreground">Authorization, cookies, API keys and secret variables are shown as ***.</p>
            </div>
          )
        )}
      </DialogContent>
    </Dialog>
  )
}
