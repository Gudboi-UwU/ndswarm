import { PlusIcon, XIcon } from 'lucide-react'
import { useState } from 'react'
import type { HttpSettings, Load, Stage, Threshold, ThresholdMetric, ThresholdOp } from '@/api/types'
import { TimeChart, type ChartSeries } from '@/components/time-chart'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { formatElapsed } from '@/lib/format'
import { Help } from '@/components/table-help'
import { glossary } from '@/lib/glossary'
import { METRICS, OPS, ruleSentence } from '@/lib/thresholds'
import { cn } from '@/lib/utils'
import { uid, useBuilder } from './draft'

const PREVIEW: ChartSeries[] = [{ label: 'Users', color: '--primary', fill: true }]

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

/** A load is "simple" when it ramps up once and then holds: what most tests need. */
function simpleShape(l: Load): { users: number; ramp: number; total: number } | null {
  const [a, b] = l.stages
  if (l.stages.length === 2 && a.target === b.target && a.target > 0) return { users: a.target, ramp: a.durationSec, total: a.durationSec + b.durationSec }
  return null
}

/**
 * Two levels: a simple form (users, length, ramp-up) that covers most tests, and custom
 * stages with patterns for spikes and steps. Virtual users move linearly between stage targets.
 */
export function LoadEditor({ load, onChange }: { load: Load; onChange: (l: Load) => void }) {
  const { readOnly } = useBuilder()
  const [custom, setCustom] = useState(() => simpleShape(load) === null)
  const simple = simpleShape(load)
  const peak = Math.max(...load.stages.map((s) => s.target), 10)
  const choose = (toCustom: boolean) => {
    if (!toCustom && !simple) onChange({ ...load, stages: [{ durationSec: 10, target: peak }, { durationSec: 50, target: peak }], maxVUs: peak })
    setCustom(toCustom)
  }
  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="grid max-w-[65ch] gap-1">
          <h2 className="text-lg font-medium">How much load?</h2>
          <p className="text-sm text-muted-foreground">
            A <Help help={glossary.users}>simulated user</Help> sends the requests one after another, as fast as the server answers. More users means more requests at the same time.
          </p>
        </div>
        <div className="grid gap-1">
          <div className="flex rounded-md border p-0.5" role="radiogroup" aria-label="Load mode">
            {([false, true] as const).map((c) => (
              <button
                key={String(c)}
                type="button"
                role="radio"
                aria-checked={custom === c}
                disabled={readOnly}
                onClick={() => choose(c)}
                className={cn('rounded px-3 py-1 text-sm', custom === c ? 'bg-muted font-medium' : 'text-muted-foreground hover:text-foreground')}
              >
                {c ? 'Custom stages' : 'Simple'}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">{custom ? 'Spikes, steps, ramping down.' : 'Users, length and ramp-up.'}</p>
        </div>
      </div>
      {!custom && simple ? <SimpleLoad load={load} shape={simple} onChange={onChange} /> : <CustomLoad load={load} onChange={onChange} />}
      {custom && simple === null && <p className="text-sm text-muted-foreground">Switching to Simple replaces these stages with one ramp-up and a steady part.</p>}
    </div>
  )
}

function SimpleLoad({ load, shape, onChange }: { load: Load; shape: { users: number; ramp: number; total: number }; onChange: (l: Load) => void }) {
  const { errors } = useBuilder()
  const [unit, setUnit] = useState<'s' | 'min'>(shape.total >= 120 && shape.total % 60 === 0 ? 'min' : 's')
  const set = (users: number, ramp: number, total: number) => {
    users = Math.max(1, Math.round(users) || 1)
    total = Math.max(2, Math.round(total) || 2)
    ramp = Math.min(Math.max(1, Math.round(ramp) || 1), total - 1)
    onChange({ ...load, stages: [{ durationSec: ramp, target: users }, { durationSec: total - ramp, target: users }], maxVUs: users })
  }
  const factor = unit === 'min' ? 60 : 1
  const hold = shape.total - shape.ramp
  const err = errors.get('load.stages.0.target') ?? errors.get('load.maxVUs') ?? errors.get('load.stages')
  return (
    <div className="grid gap-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="grid gap-2">
          <Label htmlFor="load-users">Simulated users</Label>
          <Input id="load-users" type="number" min={1} className="font-mono" value={shape.users} aria-invalid={err ? true : undefined} onChange={(e) => set(Number(e.target.value), shape.ramp, shape.total)} />
          <p className="text-xs text-muted-foreground">Sending requests at the same time.</p>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="load-total">Test length</Label>
          <div className="flex gap-2">
            <Input
              id="load-total"
              type="number"
              min={1}
              className="font-mono"
              value={+(shape.total / factor).toFixed(2)}
              onChange={(e) => set(shape.users, shape.ramp, Number(e.target.value) * factor)}
            />
            <select aria-label="Unit" className="h-8 rounded-lg border bg-transparent px-2 text-sm dark:bg-input/30" value={unit} onChange={(e) => setUnit(e.target.value as 's' | 'min')}>
              <option value="s">seconds</option>
              <option value="min">minutes</option>
            </select>
          </div>
          <p className="text-xs text-muted-foreground">Including the ramp-up.</p>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="load-ramp">Ramp-up (seconds)</Label>
          <Input id="load-ramp" type="number" min={1} className="font-mono" value={shape.ramp} onChange={(e) => set(shape.users, Number(e.target.value), shape.total)} />
          <p className="text-xs text-muted-foreground">Users are added gradually, not all at once.</p>
        </div>
      </div>
      {err && <p className="text-sm text-destructive">{err}</p>}
      <p className="rounded-md bg-muted/50 px-4 py-3 text-sm">
        Starts with 0 users, reaches <strong>{shape.users}</strong> after <strong>{duration(shape.ramp)}</strong>, then keeps {shape.users === 1 ? 'it' : 'them'} busy for{' '}
        <strong>{duration(hold)}</strong>. Total <strong>{duration(shape.total)}</strong>.
      </p>
      <TimeChart title="Planned users over time" data={[[0, shape.ramp, shape.total], [0, shape.users, shape.users]]} series={PREVIEW} digits={0} height={140} />
    </div>
  )
}

function duration(sec: number): string {
  if (sec < 60) return `${sec} second${sec === 1 ? '' : 's'}`
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return s ? `${m} min ${s} s` : `${m} minute${m === 1 ? '' : 's'}`
}

/**
 * Rules checked once against the run's final totals when it finishes; any broken rule marks
 * the whole run failed, even if every request got a response.
 */
export function ThresholdsEditor({ thresholds, onChange }: { thresholds: Threshold[]; onChange: (t: Threshold[]) => void }) {
  const { errors, readOnly } = useBuilder()
  const update = (i: number, patch: Partial<Threshold>) => onChange(thresholds.map((t, j) => (j === i ? { ...t, ...patch } : t)))
  const remove = (i: number) => onChange(thresholds.filter((_, j) => j !== i))
  const add = () => onChange([...thresholds, { id: uid(), metric: 'failed_pct', op: '<=', value: 1 }])

  return (
    <div className="grid gap-3 border-t pt-6">
      <div className="grid max-w-[65ch] gap-1">
        <h2 className="text-lg font-medium">Pass/fail rules</h2>
        <p className="text-sm text-muted-foreground">
          Checked once, against the whole run's numbers, when the test finishes. Any broken rule marks the run failed, even if nothing crashed.
        </p>
      </div>
      {thresholds.length === 0 && (
        <p className="rounded-md bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
          No rules yet, so a run that finishes always passes. Add one to catch bad results too, for example "failed requests at most 1%" to fail the
          run if the server starts erroring under load.
        </p>
      )}
      <div className="grid gap-3">
        {thresholds.map((t, i) => {
          const err = errors.get(`thresholds.${i}.metric`) ?? errors.get(`thresholds.${i}.op`) ?? errors.get(`thresholds.${i}.value`) ?? errors.get(`thresholds.${i}.id`)
          return (
            <div key={t.id} className="grid gap-1">
              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_8rem_6rem_auto] sm:items-center">
                <Select value={t.metric} onValueChange={(v) => update(i, { metric: v as ThresholdMetric })} disabled={readOnly}>
                  <SelectTrigger aria-label={`Rule ${i + 1} metric`} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {METRICS.map((m) => (
                      <SelectItem key={m.value} value={m.value}>
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2 sm:contents">
                  <Select value={t.op} onValueChange={(v) => update(i, { op: v as ThresholdOp })} disabled={readOnly}>
                    <SelectTrigger aria-label={`Rule ${i + 1} comparison`} className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {OPS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    aria-label={`Rule ${i + 1} value`}
                    type="number"
                    className="font-mono"
                    value={t.value}
                    aria-invalid={err ? true : undefined}
                    readOnly={readOnly}
                    onChange={(e) => update(i, { value: Number(e.target.value) })}
                  />
                  <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove rule ${i + 1}`} disabled={readOnly} onClick={() => remove(i)}>
                    <XIcon />
                  </Button>
                </div>
              </div>
              <p className="text-sm text-muted-foreground">{ruleSentence(t)}</p>
              {err && <p className="text-sm text-destructive">{err}</p>}
            </div>
          )
        })}
      </div>
      {errors.get('thresholds') && <p className="text-sm text-destructive">{errors.get('thresholds')}</p>}
      {!readOnly && (
        <div>
          <Button type="button" variant="outline" size="sm" onClick={add}>
            <PlusIcon />
            Add rule
          </Button>
        </div>
      )}
    </div>
  )
}

function CustomLoad({ load, onChange }: { load: Load; onChange: (l: Load) => void }) {
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
        <h3 className="text-sm font-medium">Start from a pattern</h3>
        <div className="flex flex-wrap items-end gap-3">
          <div className="grid gap-2">
            <Label htmlFor="peak">Highest number of users</Label>
            <Input id="peak" type="number" min={1} className="w-28 font-mono" value={peak} onChange={(e) => setPeak(Math.max(1, Number(e.target.value)))} />
          </div>
          {presets.map((p) => (
            <Button key={p.name} type="button" variant="outline" title={p.help} disabled={readOnly} onClick={() => onChange({ ...load, stages: p.stages(peak), maxVUs: Math.max(peak, 5) })}>
              {p.name}
            </Button>
          ))}
        </div>
        <p className="text-sm text-muted-foreground">Hover a pattern to see what it does. It replaces the stages below, which you can then edit.</p>
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
          <span className="text-xs text-muted-foreground">Over this many seconds</span>
          <span className="text-xs text-muted-foreground">move to this many users</span>
          <span aria-hidden="true" />
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
          <Label htmlFor="max-vus">User limit</Label>
          <Input id="max-vus" type="number" min={1} className="w-32 font-mono" value={load.maxVUs} aria-invalid={errors.get('load.maxVUs') ? true : undefined} onChange={(e) => onChange({ ...load, maxVUs: Number(e.target.value) })} />
          <p className="text-sm text-destructive">{errors.get('load.maxVUs')}</p>
          <p className="-mt-2 text-sm text-muted-foreground">No stage may go above this.</p>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="graceful">Finishing time at the end (seconds)</Label>
          <Input id="graceful" type="number" min={0} className="w-32 font-mono" value={load.gracefulStopSec} onChange={(e) => onChange({ ...load, gracefulStopSec: Number(e.target.value) })} />
          <p className="text-sm text-destructive">{errors.get('load.gracefulStopSec')}</p>
          <p className="-mt-2 text-sm text-muted-foreground">When the test ends, users get this long to finish the request they are sending.</p>
        </div>
      </section>
    </div>
  )
}

export function SettingsEditor({ settings, onChange }: { settings: HttpSettings; onChange: (s: HttpSettings) => void }) {
  const { errors } = useBuilder()
  const toggle = (key: 'keepAlive' | 'http2' | 'insecureTLS' | 'captureBodies', label: string, help: string) => (
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
      <p className="text-sm text-muted-foreground">The defaults suit most tests. Change them only for a specific reason.</p>
      {toggle('keepAlive', 'Keep connections alive', 'Reuse connections between requests, like a browser. Turn off to measure a new connection every time.')}
      {toggle('http2', 'Allow HTTP/2', 'Use HTTP/2 when the server offers it over TLS.')}
      {toggle('insecureTLS', 'Skip TLS certificate checks', 'For self-signed test servers only. Never for production servers.')}
      {toggle('captureBodies', 'Keep bodies in logs', 'Store request and response bodies of logged requests (cut at 16 KB and 64 KB).')}
      <div className="grid gap-2">
        <Label htmlFor="sample">Log successful requests (%)</Label>
        <Input
          id="sample"
          type="number"
          min={0}
          max={100}
          step={0.1}
          className="w-32 font-mono"
          value={settings.logSamplePct}
          aria-invalid={errors.get('settings.logSamplePct') ? true : undefined}
          onChange={(e) => onChange({ ...settings, logSamplePct: Number(e.target.value) })}
        />
        <p className="text-sm text-muted-foreground">
          {errors.get('settings.logSamplePct') ?? 'Errors are always logged. Per endpoint and second at most 50 errors, 20 successes and the slowest request are kept.'}
        </p>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="ua">User-Agent</Label>
        <Input id="ua" placeholder="ndswarm/<version>" value={settings.userAgent} aria-invalid={errors.get('settings.userAgent') ? true : undefined} onChange={(e) => onChange({ ...settings, userAgent: e.target.value })} />
        <p className="text-sm text-muted-foreground">{errors.get('settings.userAgent') ?? 'Sent unless an endpoint sets its own header.'}</p>
      </div>
    </div>
  )
}
