import { useEffect, type ReactNode } from 'react'
import { errorMessage } from '@/api/client'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'

/** Sets the browser tab title to "part · part · ndswarm", most specific first. */
export function useTitle(...parts: (string | undefined)[]): void {
  useEffect(() => {
    document.title = [...parts.filter(Boolean), 'ndswarm'].join(' · ')
  }, [parts.join('\u0000')]) // eslint-disable-line react-hooks/exhaustive-deps
}

/** Message plus a "Try again" button, for a query that failed to load. */
export function ErrorState({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <div className="grid gap-3 rounded-lg border border-dashed p-6">
      <p className="text-sm text-destructive">{errorMessage(error)}</p>
      <div>
        <Button variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      </div>
    </div>
  )
}

export function PageHeader({ title, description, actions, back }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; back?: ReactNode }) {
  return (
    <header className="mb-8">
      {back && (
        <nav aria-label="Breadcrumb" className="mb-3 text-sm text-muted-foreground">
          {back}
        </nav>
      )}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold tracking-tight">{title}</h1>
          {description && <p className="mt-1 max-w-[70ch] text-sm text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex max-w-full shrink-0 flex-wrap gap-2">{actions}</div>}
      </div>
    </header>
  )
}

export function EmptyState({ icon, title, children, action }: { icon: ReactNode; title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed p-8">
      <span className="text-primary [&_svg]:size-5">{icon}</span>
      <h2 className="font-medium">{title}</h2>
      <p className="max-w-[60ch] text-sm text-muted-foreground">{children}</p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

/** Destructive confirmation. `target` doubles as the open state. */
export function ConfirmDelete({
  target,
  title,
  description,
  confirm,
  pendingLabel,
  pending,
  error,
  onConfirm,
  onCancel,
}: {
  target: unknown
  title: string
  description: string
  confirm: string
  pendingLabel?: string
  pending?: boolean
  error?: unknown
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <AlertDialog open={target != null} onOpenChange={(open) => !open && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {error != null && <p className="text-sm text-destructive">{errorMessage(error)}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={pending}
            onClick={(e) => {
              // AlertDialogAction closes the dialog on click by default; prevent that so a
              // pending mutation (and its error, shown above) stays visible until it succeeds.
              e.preventDefault()
              onConfirm()
            }}
          >
            {pending ? (pendingLabel ?? confirm) : confirm}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
