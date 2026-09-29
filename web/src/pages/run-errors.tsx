import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { api, errorMessage } from '@/api/client'
import type { ErrorsView, RunKey } from '@/api/types'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatElapsed, formatNumber } from '@/lib/format'
import { Help, HelpIcon } from '@/components/table-help'
import { glossary } from '@/lib/glossary'
import { categoryHelp, categoryLabel, keyLabel } from '@/lib/run'
import { LogDetailDialog } from './run-logs'

/** What went wrong: totals per category, then each distinct message with an example request. */
export function ErrorsTab({ runId, keys: runKeys, live, onShowLogs }: { runId: number; keys: RunKey[]; live: boolean; onShowLogs: (category: string, key: number) => void }) {
  const [example, setExample] = useState<number | null>(null)
  const view = useQuery({
    queryKey: ['run', runId, 'errors'],
    queryFn: () => api<ErrorsView>('GET', `/runs/${runId}/errors`),
    refetchInterval: live ? 2000 : false,
  })
  if (view.isPending) return <Skeleton className="h-48" />
  if (view.isError) return <p className="text-sm text-destructive">{errorMessage(view.error)}</p>
  const v = view.data
  const cats = Object.entries(v.byCategory).sort(([, a], [, b]) => b - a)
  if (cats.length === 0) return <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">Nothing failed in this run.</p>

  return (
    <div className="grid gap-6">
      <dl className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-3">
        {cats.map(([cat, n]) => (
          <div key={cat} className="rounded-lg border p-3">
            <dt className="text-xs text-muted-foreground">
              {categoryLabel[cat] ?? cat}
              <HelpIcon label={categoryLabel[cat] ?? cat} help={categoryHelp[cat] ?? glossary.failed} />
            </dt>
            <dd className="mt-1 font-mono text-xl font-semibold text-destructive tabular-nums">{formatNumber(n)}</dd>
          </div>
        ))}
      </dl>
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>
                <Help help="What went wrong, as the server or the network reported it. Numbers such as ports are replaced by N so that the same problem is counted once.">What went wrong</Help>
              </TableHead>
              <TableHead>Request</TableHead>
              <TableHead className="w-24 text-right">
                <Help help="How many requests failed this way, including the ones not kept in the request log.">Times</Help>
              </TableHead>
              <TableHead className="w-36">
                <Help help="The first and the last second of the run in which this failure happened.">When</Help>
              </TableHead>
              <TableHead className="w-44">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className="text-sm">
            {v.groups.map((g) => (
              <TableRow key={`${g.keyId}-${g.category}-${g.message}`}>
                <TableCell className="max-w-96 whitespace-normal">
                  <span className="mr-2 text-xs text-muted-foreground">{categoryLabel[g.category] ?? g.category}</span>
                  <span className="break-words">{g.message}</span>
                </TableCell>
                <TableCell>{keyLabel(runKeys.find((k) => k.keyId === g.keyId))}</TableCell>
                <TableCell className="text-right font-mono tabular-nums">{formatNumber(g.count)}</TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground tabular-nums">
                  {formatElapsed(g.firstSec)} to {formatElapsed(g.lastSec)}
                </TableCell>
                <TableCell className="text-right">
                  {g.exampleLogId && (
                    <Button variant="ghost" size="sm" onClick={() => setExample(g.exampleLogId)}>
                      Show one
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" onClick={() => onShowLogs(g.category, g.keyId)}>
                    All in log
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <LogDetailDialog runId={runId} logId={example} keys={runKeys} onClose={() => setExample(null)} />
    </div>
  )
}
