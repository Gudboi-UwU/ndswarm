import { useQuery } from '@tanstack/react-query'
import { WandSparklesIcon } from 'lucide-react'
import { useDeferredValue, useRef, useState, type ComponentProps } from 'react'
import { api } from '@/api/client'
import type { FieldType, RenderResult } from '@/api/types'
import { Button } from '@/components/ui/button'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useBuilder } from './draft'

type Props = Omit<ComponentProps<typeof Input>, 'value' | 'onChange'> & {
  value: string
  onChange: (v: string) => void
  /** Field type the value converts to; the preview checks it. */
  type?: FieldType
  error?: string
}

/** Text input for template values, with a { } picker that inserts generators and shows live samples. */
export function TemplateInput({ value, onChange, type, error, className, ...rest }: Props) {
  const ref = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const { readOnly } = useBuilder()

  const insert = (snippet: string) => {
    const el = ref.current
    const start = el?.selectionStart ?? value.length
    const end = el?.selectionEnd ?? value.length
    const next = value.slice(0, start) + snippet + value.slice(end)
    onChange(next)
    setOpen(false)
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(start + snippet.length, start + snippet.length)
    })
  }

  return (
    <div className={cn('relative', className)}>
      <Input
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        className="pr-9 font-mono text-[13px]"
        spellCheck={false}
        {...rest}
      />
      {!readOnly && (
        <Popover open={open} onOpenChange={setOpen}>
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="absolute top-1/2 right-1.5 -translate-y-1/2 text-muted-foreground hover:text-primary"
                  aria-label="Insert generated value"
                >
                  <WandSparklesIcon />
                </Button>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent>Insert random data or a variable</TooltipContent>
          </Tooltip>
          <PopoverContent align="end" className="w-80 p-0">
            {open && <Picker value={value} type={type} onPick={insert} />}
          </PopoverContent>
        </Popover>
      )}
      {error && <p className="mt-1 text-sm text-destructive">{error}</p>}
    </div>
  )
}

function Picker({ value, type, onPick }: { value: string; type?: FieldType; onPick: (s: string) => void }) {
  const { generators, variables } = useBuilder()
  const groups = new Map<string, { label: string; snippet: string; hint: string }[]>()
  if (variables.length) {
    groups.set(
      'Target variables',
      variables.map((v) => ({ label: v.key, snippet: `{{var "${v.key}"}}`, hint: v.secret ? 'secret' : '' })),
    )
  }
  for (const g of generators) {
    const list = groups.get(g.group) ?? []
    list.push({ label: g.label, snippet: g.snippet, hint: g.output === 'string' ? '' : g.output })
    groups.set(g.group, list)
  }
  return (
    <div>
      <Preview value={value} type={type} />
      <Command>
        <CommandInput placeholder="Search: email, number, date, name..." />
        <CommandList className="max-h-72">
          <CommandEmpty>No match.</CommandEmpty>
          {[...groups].map(([group, items]) => (
            <CommandGroup key={group} heading={group}>
              {items.map((it) => (
                <CommandItem key={it.snippet} value={`${it.label} ${it.snippet}`} onSelect={() => onPick(it.snippet)}>
                  <span className="truncate">{it.label}</span>
                  <span className="ml-auto truncate font-mono text-xs text-muted-foreground">{it.hint || it.snippet}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
        </CommandList>
      </Command>
    </div>
  )
}

/** Five rendered samples of the current value, or the error a run would hit. */
export function Preview({ value, type }: { value: string; type?: FieldType }) {
  const { environmentId } = useBuilder()
  const deferred = useDeferredValue(value)
  const render = useQuery({
    queryKey: ['render', deferred, type, environmentId],
    queryFn: () => api<RenderResult>('POST', '/tools/render', { template: deferred, type: type ?? '', environmentId }),
    enabled: deferred.includes('{{'),
    staleTime: 0,
  })
  if (!deferred.includes('{{')) {
    return <p className="border-b px-3 py-2 text-xs text-muted-foreground">Pick a value to insert at the cursor. Each request gets a new one, for example a different email every time.</p>
  }
  const r = render.data
  return (
    <div className="border-b px-3 py-2 text-xs">
      <p className="mb-1 text-muted-foreground">Example values</p>
      {r?.error ? (
        <p className="text-destructive">{r.error}</p>
      ) : (
        <ul className="space-y-0.5 font-mono">
          {(r?.samples ?? []).map((s, i) => (
            <li key={i} className="truncate">
              {s || <span className="text-muted-foreground">(empty)</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
