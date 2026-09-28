import type { Timing } from '@/api/types'

export function Waterfall({ t }: { t: Timing }) {
  const phases: [string, number][] = [
    ['DNS', t.dns],
    ['Connect', t.connect],
    ['TLS', t.tls],
    ['Waiting', t.ttfb],
    ['Download', t.download],
  ]
  const total = Math.max(t.total, 0.001)
  return (
    <dl className="grid grid-cols-[5rem_1fr_5rem] items-center gap-x-3 gap-y-1 text-xs">
      {phases.map(([name, ms]) => (
        <div key={name} className="contents">
          <dt className="text-muted-foreground">{name}</dt>
          <div className="h-1.5">
            <div className="h-full rounded-full bg-primary/70" style={{ width: `${Math.max((ms / total) * 100, ms > 0 ? 1 : 0)}%` }} />
          </div>
          <dd className="text-right font-mono tabular-nums">{ms.toFixed(1)} ms</dd>
        </div>
      ))}
      {t.reused && <p className="col-span-3 text-muted-foreground">Connection reused, so DNS, connect and TLS were skipped.</p>}
    </dl>
  )
}

export function Code({ text, note }: { text: string; note?: string }) {
  return (
    <div>
      <pre className="max-h-96 overflow-auto rounded-md bg-muted p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-all">{text || '(empty)'}</pre>
      {note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}
    </div>
  )
}
