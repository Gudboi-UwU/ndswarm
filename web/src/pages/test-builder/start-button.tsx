import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CircleAlertIcon, CircleCheckIcon, PlayIcon, TriangleAlertIcon } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { api, ApiError, errorMessage } from '@/api/client'
import { keys } from '@/api/keys'
import type { Preflight } from '@/api/types'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

/** Starts a run. The server runs preflight first; problems open a dialog. */
export function StartButton({ testId, blockedReason, beforeStart }: { testId: number; blockedReason?: string; beforeStart?: () => Promise<boolean> }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [preflight, setPreflight] = useState<Preflight | null>(null)
  const start = useMutation({
    mutationFn: async (force: boolean) => {
      if (beforeStart && !(await beforeStart())) throw new Error('Fix the fields marked in red, then run again.')
      return api<{ id: number }>('POST', `/tests/${testId}/runs`, { force })
    },
    onSuccess: async ({ id }) => {
      setPreflight(null)
      await queryClient.invalidateQueries({ queryKey: keys.activeRun })
      await navigate(`/runs/${id}`)
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 422 && e.body.preflight) {
        setPreflight(e.body.preflight as Preflight)
      } else if (e instanceof ApiError && e.status === 409) {
        const runId = e.body.runId as number | null
        toast.error('A test is already running.', runId ? { action: { label: 'View run', onClick: () => void navigate(`/runs/${runId}`) } } : undefined)
      } else {
        toast.error(errorMessage(e))
      }
    },
  })

  const button = (
    <Button onClick={() => start.mutate(false)} disabled={!!blockedReason || start.isPending}>
      <PlayIcon />
      {start.isPending && !preflight ? 'Checking' : 'Run test'}
    </Button>
  )
  const blocking = (preflight?.errors.length ?? 0) > 0

  return (
    <>
      {blockedReason ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span tabIndex={0}>{button}</span>
          </TooltipTrigger>
          <TooltipContent>{blockedReason}</TooltipContent>
        </Tooltip>
      ) : (
        button
      )}
      <Dialog open={preflight !== null} onOpenChange={(o) => !o && setPreflight(null)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{blocking ? 'This test cannot run yet' : 'Some requests failed the quick check'}</DialogTitle>
            <DialogDescription>
              {blocking
                ? 'Before every run, ndswarm builds each request once. These problems would make every request fail, so nothing was started.'
                : 'Before every run, ndswarm sends each request once. The ones below failed. If that is expected (for example a test for errors), run anyway.'}
            </DialogDescription>
          </DialogHeader>
          {preflight && (
            <div className="grid gap-4">
              {preflight.errors.length > 0 && (
                <ul className="grid gap-2">
                  {preflight.errors.map((e) => (
                    <li key={e} className="flex gap-2 text-sm text-destructive">
                      <CircleAlertIcon className="mt-0.5 size-4 shrink-0" />
                      {e}
                    </li>
                  ))}
                </ul>
              )}
              {preflight.checks.length > 0 && (
                <ul className="grid gap-2">
                  {preflight.checks.map((c) => (
                    <li key={c.name} className="grid gap-1 rounded-md border p-3 text-sm">
                      <div className="flex items-center gap-2">
                        {c.error ? <TriangleAlertIcon className="size-4 shrink-0 text-destructive" /> : <CircleCheckIcon className="size-4 shrink-0 text-primary" />}
                        <span className="font-medium">{c.name}</span>
                        <span className="ml-auto font-mono text-xs text-muted-foreground tabular-nums">
                          {c.status ? `HTTP ${c.status}` : 'no response'} in {c.latencyMs.toFixed(1)} ms
                        </span>
                      </div>
                      <p className="truncate font-mono text-xs text-muted-foreground">
                        {c.method} {c.url}
                      </p>
                      {c.error && <p className="text-destructive">{c.error}</p>}
                      {c.snippet && <pre className="max-h-24 overflow-auto rounded bg-muted p-2 font-mono text-xs whitespace-pre-wrap break-all">{c.snippet}</pre>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPreflight(null)}>
              Back to the test
            </Button>
            {!blocking && (
              <Button onClick={() => start.mutate(true)} disabled={start.isPending}>
                Run anyway
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
