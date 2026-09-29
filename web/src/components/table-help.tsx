import { ArrowDownIcon, ArrowUpIcon, ChevronsUpDownIcon, CircleHelpIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { SortState } from '@/lib/sort'
import { cn } from '@/lib/utils'

/** A column title that explains itself on hover (dotted underline marks it as explained). */
export function Help({ children, help }: { children: ReactNode; help: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="cursor-help underline decoration-muted-foreground/50 decoration-dotted underline-offset-4">
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-72 text-left font-normal">{help}</TooltipContent>
    </Tooltip>
  )
}

/** A heading followed by a small (?) that explains it on hover: calmer than underlining a title. */
export function HelpIcon({ help, label }: { help: string; label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" aria-label={`About ${label}`} className="ml-1 inline-flex align-middle text-muted-foreground hover:text-foreground">
          <CircleHelpIcon className="size-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-72 text-left font-normal">{help}</TooltipContent>
    </Tooltip>
  )
}

/** A clickable column title; clicking again flips the order. */
export function SortButton<K extends string>({ label, sortKey, sort, onSort, help, align = 'left' }: { label: string; sortKey: K; sort: SortState<K>; onSort: (s: SortState<K>) => void; help?: string; align?: 'left' | 'right' }) {
  const active = sort.key === sortKey
  const Icon = !active ? ChevronsUpDownIcon : sort.dir === 'asc' ? ArrowUpIcon : ArrowDownIcon
  return (
    <span className={cn('inline-flex items-center gap-1', align === 'right' && 'flex-row-reverse')}>
      {help ? <Help help={help}>{label}</Help> : label}
      <button
        type="button"
        aria-label={`Sort by ${label}${active ? (sort.dir === 'asc' ? ', ascending' : ', descending') : ''}`}
        onClick={() => onSort({ key: sortKey, dir: active && sort.dir === 'desc' ? 'asc' : 'desc' })}
        className={cn('rounded p-0.5 hover:bg-muted', active ? 'text-foreground' : 'text-muted-foreground/60')}
      >
        <Icon className="size-3.5" />
      </button>
    </span>
  )
}
