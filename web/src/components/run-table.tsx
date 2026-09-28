import { Link } from 'react-router'
import type { Run } from '@/api/types'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatDate, formatElapsed, formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'

export function RunStatus({ run }: { run: Pick<Run, 'status' | 'verdict'> }) {
  if (run.status === 'finished') return <Badge variant={run.verdict === 'fail' ? 'destructive' : 'default'}>{run.verdict === 'fail' ? 'Failed' : 'Passed'}</Badge>
  const label: Record<string, string> = { running: 'Running', stopping: 'Stopping', aborted: 'Stopped', failed: 'Error' }
  return <Badge variant={run.status === 'failed' ? 'destructive' : run.status === 'running' ? 'default' : 'secondary'}>{label[run.status] ?? run.status}</Badge>
}

/** Runs with their headline numbers, newest first. */
export function RunTable({ runs, showTest = true }: { runs: Run[]; showTest?: boolean }) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-20">Run</TableHead>
            {showTest && <TableHead>Test</TableHead>}
            <TableHead className="w-28">Result</TableHead>
            <TableHead className="hidden w-44 md:table-cell">Started</TableHead>
            <TableHead className="w-24 text-right">Duration</TableHead>
            <TableHead className="w-28 text-right">Requests</TableHead>
            <TableHead className="w-24 text-right">Avg</TableHead>
            <TableHead className="w-24 text-right">p95</TableHead>
            <TableHead className="w-24 text-right">Errors</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody className="text-sm">
          {runs.map((r) => {
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
                  <RunStatus run={r} />
                </TableCell>
                <TableCell className="hidden text-muted-foreground md:table-cell">{formatDate(r.startedAt)}</TableCell>
                <TableCell className="text-right font-mono tabular-nums">{formatElapsed(r.summary?.elapsedSec ?? 0)}</TableCell>
                <TableCell className="text-right font-mono tabular-nums">{t ? formatNumber(t.count) : '-'}</TableCell>
                <TableCell className="text-right font-mono tabular-nums">{t ? `${formatNumber(t.avg, 1)} ms` : '-'}</TableCell>
                <TableCell className="text-right font-mono tabular-nums">{t ? `${formatNumber(t.p95, 1)} ms` : '-'}</TableCell>
                <TableCell className={cn('text-right font-mono tabular-nums', errPct > 0 && 'text-destructive')}>{t ? `${formatNumber(errPct, 1)}%` : '-'}</TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
