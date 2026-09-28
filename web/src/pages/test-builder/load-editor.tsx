import { PlusIcon, XIcon } from 'lucide-react'
import { useState } from 'react'
import type { HttpSettings, Load, Stage } from '@/api/types'
import { TimeChart, type ChartSeries } from '@/components/time-chart'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { formatElapsed } from '@/lib/format'
import { useBuilder } from './draft'

const PREVIEW: ChartSeries[] = [{ label: 'Target VUs', color: '--primary', fill: true }]

const presets: { name: string; help: string; stages: (n: number) => Stage[] }[] = [
  { name: 'Smoke', help: '5 users for 1 minute', stages: () => [{ durationSec: 5, target: 5 }, { durationSec: 55, target: 5 }] },
  { name: 'Load', help: 'Ramp to peak in 2 min, hold 5 min, ramp down 1 min', stages: (n) => [{ durationSec: 120, target: n }, { durationSec: 300, target: n }, { durationSec: 60, target: 0 }] },
  {
    name: 'Stress',
    help: 'Four steps up to peak, 3 min each',
    stages: (n) => [1, 2, 3, 4].flatMap((i) => [{ durationSec: 60, target: Math.round((n * i) / 4) }, { durationSec: 120, target: Math.round((n * i) / 4) }]).concat({ durationSec: 60, target: 0 }),
  },
  {
    name: 'Spike',
    help: '10% of peak, then jump to peak in 10 s',
    stages: (n) => {
      const low = Math.max(1, Math.round(n / 10))
      return [{ durationSec: 30, target: low }, { durationSec: 60, target: low }, { durationSec: 10, target: n }, { durationSec: 60, target: n }, { durationSec: 10, target: low }, { durationSec: 60, target: low }, { durationSec: 30, target: 0 }]
    },
  },
  { name: 'Soak', help: 'Peak for 1 hour', stages: (n) => [{ durationSec: 60, target: n }, { durationSec: 3480, target: n }, { durationSec: 60, target: 0 }] },
]

/** Closed-model load: virtual users move linearly from one stage target to the next. */
export function LoadEditor({ load, onChange }: { load: Load; onChange: (l: Load) => void }) {
  const { errors, readOnly } = useBuilder()
  const [peak, setPeak] = useState(() => Math.max(...load.stages.map((s) => s.target), 10))
  const stages = load.stages
  const setStages = (next: Stage[]) => onChange({ ...load, stages: next, maxVUs: Math.max(load.maxVUs, ...next.map((s) => s.target)) })
  const update = (i: number, patch: Partial<Stage>) => setStages(stages.map((s, j) => (j === i ? { ...s, ...patch } : s)))

  let at = 0
  const xs = [0]
  const ys = [0]
  for (const s of stages) {
    at += s.durationSec
    xs.push(at)
    ys.push(s.target)
  }

  return (
    <div className="grid gap-8">
      <section className="grid gap-3">
        <h3 className="text-sm font-medium">Presets</h3>
        <div className="flex flex-wrap items-end gap-3">
          <div className="grid gap-2">
            <Label htmlFor="peak">Peak users</Label>
            <Input id="peak" type="number" min={1} className="w-28 font-mono" value={peak} onChange={(e) => setPeak(Math.max(1, Number(e.target.value)))} />
          </div>
          {presets.map((p) => (
            <Button key={p.name} type="button" variant="outline" title={p.help} disabled={readOnly} onClick={() => onChange({ ...load, stages: p.stages(peak), maxVUs: Math.max(peak, 5) })}>
              {p.name}
            </Button>
          ))}
        </div>
        <p className="text-sm text-muted-foreground">A preset replaces the stages below. You can edit them afterwards.</p>
      </section>

      <section className="grid gap-3">
        <div className="flex items-baseline justify-between">
          <h3 className="text-sm font-medium">Stages</h3>
          <span className="font-mono text-sm text-muted-foreground">Total {formatElapsed(at)}</span>
        </div>
        <TimeChart title="Planned virtual users" data={[xs, ys]} series={PREVIEW} digits={0} height={160} />
        {errors.get('load.stages') && <p className="text-sm text-destructive">{errors.get('load.stages')}</p>}
        <div className="grid grid-cols-[2rem_minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-2 text-sm">
          <span className="text-xs text-muted-foreground">#</span>
          <span className="text-xs text-muted-foreground">Duration (seconds)</span>
          <span className="text-xs text-muted-foreground">Ramp to users</span>
          <span className="sr-only">Remove</span>
          {stages.map((s, i) => {
            const err = errors.get(`load.stages.${i}.durationSec`) ?? errors.get(`load.stages.${i}.target`)
            return (
              <div key={i} className="contents">
                <span className="font-mono text-muted-foreground">{i + 1}</span>
                <Input
                  aria-label={`Stage ${i + 1} duration`}
                  type="number"
                  min={1}
                  className="font-mono"
                  value={s.durationSec}
                  aria-invalid={errors.get(`load.stages.${i}.durationSec`) ? true : undefined}
                  onChange={(e) => update(i, { durationSec: Number(e.target.value) })}
                />
                <Input
                  aria-label={`Stage ${i + 1} target users`}
                  type="number"
                  min={0}
                  className="font-mono"
                  value={s.target}
                  aria-invalid={errors.get(`load.stages.${i}.target`) ? true : undefined}
                  onChange={(e) => update(i, { target: Number(e.target.value) })}
                />
                <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove stage ${i + 1}`} disabled={stages.length === 1} onClick={() => setStages(stages.filter((_, j) => j !== i))}>
                  <XIcon />
                </Button>
                {err && <p className="col-span-4 text-sm text-destructive">{err}</p>}
              </div>
            )
          })}
        </div>
        {!readOnly && (
          <div>
            <Button type="button" variant="outline" size="sm" onClick={() => setStages([...stages, { durationSec: 60, target: stages[stages.length - 1]?.target ?? 1 }])}>
              <PlusIcon />
              Add stage
            </Button>
          </div>
        )}
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="max-vus">Max users</Label>
          <Input id="max-vus" type="number" min={1} className="w-32 font-mono" value={load.maxVUs} aria-invalid={errors.get('load.maxVUs') ? true : undefined} onChange={(e) => onChange({ ...load, maxVUs: Number(e.target.value) })} />
          <p className="text-sm text-destructive">{errors.get('load.maxVUs')}</p>
          <p className="-mt-2 text-sm text-muted-foreground">Upper bound for every stage. Also sizes the connection pool.</p>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="graceful">Graceful stop (seconds)</Label>
          <Input id="graceful" type="number" min={0} className="w-32 font-mono" value={load.gracefulStopSec} onChange={(e) => onChange({ ...load, gracefulStopSec: Number(e.target.value) })} />
          <p className="text-sm text-destructive">{errors.get('load.gracefulStopSec')}</p>
          <p className="-mt-2 text-sm text-muted-foreground">After the last stage, users may finish their current request for this long.</p>
        </div>
      </section>
    </div>
  )
}

export function SettingsEditor({ settings, onChange }: { settings: HttpSettings; onChange: (s: HttpSettings) => void }) {
  const { errors } = useBuilder()
  const toggle = (key: 'keepAlive' | 'http2' | 'insecureTLS', label: string, help: string) => (
    <label className="flex items-start gap-3">
      <Switch className="mt-0.5" checked={settings[key]} onCheckedChange={(v) => onChange({ ...settings, [key]: v })} />
      <span className="grid gap-0.5">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-sm text-muted-foreground">{help}</span>
      </span>
    </label>
  )
  return (
    <div className="grid max-w-2xl gap-6">
      {toggle('keepAlive', 'Keep connections alive', 'Reuse connections between requests, like a browser. Turn off to measure a new connection every time.')}
      {toggle('http2', 'Allow HTTP/2', 'Use HTTP/2 when the server offers it over TLS.')}
      {toggle('insecureTLS', 'Skip TLS certificate checks', 'For self-signed test servers only. Never for production targets.')}
      <div className="grid gap-2">
        <Label htmlFor="ua">User-Agent</Label>
        <Input id="ua" placeholder="ndswarm/<version>" value={settings.userAgent} aria-invalid={errors.get('settings.userAgent') ? true : undefined} onChange={(e) => onChange({ ...settings, userAgent: e.target.value })} />
        <p className="text-sm text-muted-foreground">{errors.get('settings.userAgent') ?? 'Sent unless an endpoint sets its own header.'}</p>
      </div>
    </div>
  )
}
