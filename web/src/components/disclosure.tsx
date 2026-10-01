import { ChevronRightIcon } from 'lucide-react'
import { useEffect, useRef, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * A section that starts closed unless it has content. The summary line tells what is inside,
 * so people can skip what they do not need (progressive disclosure). It only ever opens itself
 * (when it gets content or an error); closing stays up to the user, so clearing the content
 * does not snap it shut under them.
 */
export function Disclosure({ title, summary, defaultOpen, error, children }: { title: string; summary?: ReactNode; defaultOpen?: boolean; error?: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    if ((defaultOpen || error) && ref.current) ref.current.open = true
  }, [defaultOpen, error])
  return (
    <details ref={ref} className="group min-w-0 rounded-lg border">
      <summary className="flex min-w-0 cursor-pointer list-none items-center gap-2 px-4 py-3 select-none [&::-webkit-details-marker]:hidden">
        <ChevronRightIcon className="size-4 text-muted-foreground transition-transform group-open:rotate-90" />
        <span className={cn('shrink-0 text-sm font-medium', error && 'text-destructive')}>{title}</span>
        {summary && <span className="min-w-0 truncate text-sm text-muted-foreground">{summary}</span>}
      </summary>
      <div className="border-t px-4 py-4">{children}</div>
    </details>
  )
}
