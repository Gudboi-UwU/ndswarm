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

/** Survives tab switches (the parent keeps it): the chosen mode and the load each mode last had. */
export type LoadMemory = { custom?: boolean; simple?: Load; customLoad?: Load }

/**
 * Two levels: a simple form (users, length, ramp-up) that covers most tests, and custom
 * stages with patterns for spikes and steps. Simulated users move linearly between stage targets.
 * Switching modes keeps what each mode had, so going back and forth loses nothing; the mode
 * shown when saving is the one that runs.
 */
export function LoadEditor({ load, onChange, memory, onMemory }: { load: Load; onChange: (l: Load) => void; memory: LoadMemory; onMemory: (m: LoadMemory) => void }) {
  const { readOnly } = useBuilder()
  const simple = simpleShape(load)
  const custom = memory.custom ?? simple === null
  const choose = (toCustom: boolean) => {
    if (toCustom === custom) return
    const next: LoadMemory = { ...memory, custom: toCustom, ...(custom ? { customLoad: load } : { simple: load }) }
    const back = toCustom ? next.customLoad : next.simple
    if (back) onChange({ ...load, stages: back.stages, maxVUs: back.maxVUs })
    else if (!toCustom && !simple) {
      const peak = Math.max(...load.stages.map((s) => s.target), 10)
      onChange({ ...load, stages: [{ durationSec: 10, target: peak }, { durationSec: 50, target: peak }], maxVUs: peak })
    }
    onMemory(next)
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
          <div className="flex w-fit rounded-md border p-0.5" role="radiogroup" aria-label="Load mode">
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
          <p className="max-w-64 text-xs text-muted-foreground">
            {custom ? 'Spikes, steps, ramping down.' : 'Users, length and ramp-up.'} Switching keeps what you set in each; the one shown when you save is the one that runs.
          </p>
        </div>
      </div>
      {!custom && simple ? <SimpleLoad load={load} shape={simple} onChange={onChange} /> : <CustomLoad load={load} onChange={onChange} />}
    </div>
  )
}

function SimpleLoad({ load, shape, onChange }: { load: Load; shape: { users: number; ramp: number; total: number }; onChange: (l: Load) => void }) {
  const { errors } = useBuilder()
  const [unit, setUnit] = useState<'s' | 'min'>(shape.total >= 120 && shape.total % 60 === 0 ? 'min' : 's')
  // Pushes a value upstream as typed, without clamping: clamping on every keystroke is what made
  // clearing "users" jump to 1 and typing "50" next read as "150". Bounds are only enforced
  // on blur, by `clamp` below.
  const setRaw = (patch: Partial<{ users: number; ramp: number; total: number }>) => {
    const users = patch.users ?? shape.users
    const ramp = patch.ramp ?? shape.ramp
    const total = patch.total ?? shape.total
    onChange({ ...load, stages: [{ durationSec: ramp, target: users }, { durationSec: Math.max(0, total - ramp), target: users }], maxVUs: users })
  }
  const clamp = () => {
    const users = Math.max(1, Math.round(shape.users) || 1)
    const total = Math.max(2, Math.round(shape.total) || 2)
    const ramp = Math.min(Math.max(1, Math.round(shape.ramp) || 1), total - 1)
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
          <LoadNumberInput id="load-users" min={1} value={shape.users} invalid={!!err} onCommit={(n) => setRaw({ users: n })} onBlur={clamp} />
          <p className="text-xs text-muted-foreground">Sending requests at the same time.</p>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="load-total">Test length</Label>
          <div className="flex gap-2">
            <LoadNumberInput
              id="load-total"
              min={1}
              value={+(shape.total / factor).toFixed(2)}
              onCommit={(n) => setRaw({ total: n * factor })}
              onBlur={clamp}
            />
            <Select value={unit} onValueChange={(v) => setUnit(v as 's' | 'min')}>
              <SelectTrigger aria-label="Unit" className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="s">seconds</SelectItem>
                <SelectItem value="min">minutes</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <p className="text-xs text-muted-foreground">Including the ramp-up.</p>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="load-ramp">Ramp-up (seconds)</Label>
          <LoadNumberInput id="load-ramp" min={1} value={shape.ramp} onCommit={(n) => setRaw({ ramp: n })} onBlur={clamp} />
          <p className="text-xs text-muted-foreground">Users are added gradually, not all at once.</p>
        </div>
      </div>
      {err && <p className="text-sm text-destructive">{err}</p>}
      <p className="rounded-md bg-muted/50 px-4 py-3 text-sm">
        Starts with 0 users, reaches <strong>{shape.users}</strong> after <strong>{duration(shape.ramp)}</strong>, then keeps {shape.users === 1 ? 'it' : 'them'} busy for{' '}
        <strong>{duration(hold)}</strong>. Total <strong>{duration(shape.total)}</strong>.
      </p>
      <TimeChart title="Planned users over time" data={[[0, shape.ramp, shape.total], [0, shape.users, shape.users]]} series={PREVIEW} digits={0} height={140} idle={`Peak ${shape.users} users, total ${formatElapsed(shape.total)}. Hover for details.`} />
    </div>
  )
}

/**
 * A number input that keeps whatever is typed as text while focused, so an in-progress edit
 * (clearing the field, a half-typed number) is never clobbered by a clamped value from the
 * parent. `onCommit` fires as soon as the text parses; `onBlur` runs last, for the caller to
 * enforce bounds (and this always snaps the shown text back to the committed value first, so
 * an invalid or empty field never stays that way after leaving it).
 */
function LoadNumberInput({ id, ariaLabel, className, value, min, invalid, onCommit, onBlur }: { id?: string; ariaLabel?: string; className?: string; value: number; min?: number; invalid?: boolean; onCommit: (v: number) => void; onBlur: () => void }) {
  const [state, setState] = useState(() => ({ value, text: String(value) }))
  if (state.value !== value) setState({ value, text: String(value) })
  return (
    <Input
      id={id}
      aria-label={ariaLabel}
      type="number"
      min={min}
      className={cn('font-mono', className)}
      value={state.text}
      aria-invalid={invalid ? true : undefined}
      onChange={(e) => {
        const text = e.target.value
        setState((s) => ({ ...s, text }))
        const n = Number(text)
        if (text.trim() !== '' && Number.isFinite(n)) onCommit(n)
      }}
      onBlur={() => {
        setState({ value, text: String(value) })
        onBlur()
      }}
    />
  )
}

function duration(sec: number): string {
  if (sec < 60) return `${sec} second${sec === 1 ? '' : 's'}`
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return s ? `${m} min ${s} s` : `${m} minute${m === 1 ? '' : 's'}`
}

// Sensible starting point per metric, kept when only the value is edited but reset when the
// metric changes (a leftover "1" from "failed at most 1%" makes no sense as "p95 at most 1 ms").
const METRIC_DEFAULTS: Record<ThresholdMetric, { value: number; op: ThresholdOp }> = {
  failed_pct: { value: 1, op: '<=' },
  avg_ms: { value: 500, op: '<=' },
  p95_ms: { value: 500, op: '<=' },
  p99_ms: { value: 500, op: '<=' },
  max_ms: { value: 500, op: '<=' },
  rps: { value: 10, op: '>=' },
}

/**
 * A number input that keeps whatever the user is typing as text, so an empty or half-typed
 * value (e.g. "0.") does not collapse to 0. It commits upstream as soon as the text parses.
 */
function ThresholdValueInput({ value, onCommit, ariaLabel, invalid, readOnly }: { value: number; onCommit: (v: number) => void; ariaLabel: string; invalid?: boolean; readOnly?: boolean }) {
  // Tracks the committed value alongside the raw text, so an external change (switching metric,
  // undo) resets the text, but typing does not get overwritten by the round trip through onCommit.
  const [state, setState] = useState(() => ({ value, text: String(value) }))
  if (state.value !== value) setState({ value, text: String(value) })
  const n = Number(state.text)
  const bad = state.text.trim() === '' || !Number.isFinite(n)
  return (
    <div className="grid gap-1">
      <Input
        aria-label={ariaLabel}
        type="number"
        className="font-mono"
        value={state.text}
        aria-invalid={invalid || bad ? true : undefined}
        readOnly={readOnly}
        onChange={(e) => {
          const text = e.target.value
          const num = Number(text)
          if (text.trim() !== '' && Number.isFinite(num)) {
            setState({ value: num, text })
            onCommit(num)
          } else {
            setState((s) => ({ ...s, text }))
          }
        }}
        onBlur={() => {
          // Leaving the field with invalid or empty text abandons the edit, instead of leaving
          // that text on screen looking like it was saved.
          if (bad) setState({ value, text: String(value) })
        }}
      />
      {bad && <p className="text-xs text-destructive">Enter a number.</p>}
    </div>
  )
}

/**
 * Rules checked once against the run's final totals when it finishes; any broken rule marks
 * the whole run failed, even if every request got a response.
 */
export function ThresholdsEditor({ thresholds, onChange }: { thresholds: Threshold[]; onChange: (t: Threshold[]) => void }) {
  const { errors, readOnly } = useBuilder()
  const update = (i: number, patch: Partial<Threshold>) => onChange(thresholds.map((t, j) => (j === i ? { ...t, ...patch } : t)))
  const setMetric = (i: number, metric: ThresholdMetric) => update(i, { metric, ...METRIC_DEFAULTS[metric] })
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
                <Select value={t.metric} onValueChange={(v) => setMetric(i, v as ThresholdMetric)} disabled={readOnly}>
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
                  <ThresholdValueInput ariaLabel={`Rule ${i + 1} value`} value={t.value} invalid={!!err} readOnly={readOnly} onCommit={(value) => update(i, { value })} />
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
  const [pattern, setPattern] = useState('Load')
  const [peak, setPeak] = useState(() => Math.max(...load.stages.map((s) => s.target), 10))
  const preset = presets.find((p) => p.name === pattern) ?? presets[1]
  const stages = load.stages
  // Stages have no id of their own (the server model is just duration + target), so React keys
  // are tracked here, client-side only, and kept in step with add/remove below. A pattern
  // replaces the whole array, so a length mismatch there just gets fresh ids.
  const [ids, setIds] = useState<string[]>(() => stages.map(() => uid()))
  if (ids.length !== stages.length) setIds(stages.map(() => uid()))
  // The user cap follows the stages: it only exists so no stage goes above it, so keeping it at
  // the highest stage is what everyone wants, and there is no separate field to keep in sync.
  const setStages = (next: Stage[]) => onChange({ ...load, stages: next, maxVUs: Math.max(1, ...next.map((s) => s.target)) })
  const update = (i: number, patch: Partial<Stage>) => setStages(stages.map((s, j) => (j === i ? { ...s, ...patch } : s)))
  const addStage = () => {
    setIds([...ids, uid()])
    setStages([...stages, { durationSec: 60, target: stages[stages.length - 1]?.target ?? 1 }])
  }
  const removeStage = (i: number) => {
    setIds(ids.filter((_, j) => j !== i))
    setStages(stages.filter((_, j) => j !== i))
  }

  let at = 0
  const xs = [0]
  const ys = [0]
  for (const s of stages) {
    at += s.durationSec
    xs.push(at)
    ys.push(s.target)
  }
  const top = Math.max(0, ...ys)

  return (
    <div className="grid gap-8">
      {!readOnly && (
        <section className="grid gap-3 rounded-md border p-4">
          <div className="grid gap-1">
            <h3 className="text-sm font-medium">Start from a pattern (optional)</h3>
            <p className="text-sm text-muted-foreground">Fills the stages below with a ready-made shape. You can edit every stage afterwards.</p>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="grid gap-2">
              <Label htmlFor="pattern">Pattern</Label>
              <Select value={pattern} onValueChange={setPattern}>
                <SelectTrigger id="pattern" className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {presets.map((p) => (
                    <SelectItem key={p.name} value={p.name}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {preset.name !== 'Smoke' && (
              <div className="grid gap-2">
                <Label htmlFor="peak">Peak users</Label>
                <LoadNumberInput id="peak" className="w-28" min={1} value={peak} onCommit={setPeak} onBlur={() => setPeak((n) => Math.max(1, Math.round(n) || 1))} />
              </div>
            )}
            <Button type="button" variant="outline" onClick={() => setStages(preset.stages(Math.max(1, Math.round(peak) || 1)))}>
              Fill stages
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{preset.name}:</span> {preset.help}. Replaces the current stages.
          </p>
        </section>
      )}

      <section className="grid gap-3">
        <div className="flex items-baseline justify-between">
          <h3 className="text-sm font-medium">Stages</h3>
          <span className="font-mono text-sm text-muted-foreground">Total {formatElapsed(at)}</span>
        </div>
        <TimeChart title="Planned simulated users" data={[xs, ys]} series={PREVIEW} digits={0} height={160} idle={`Peak ${top} users, total ${formatElapsed(at)}. Hover for details.`} />
        {errors.get('load.stages') && <p className="text-sm text-destructive">{errors.get('load.stages')}</p>}
        {errors.get('load.maxVUs') && <p className="text-sm text-destructive">{errors.get('load.maxVUs')}</p>}
        <p className="text-sm text-muted-foreground">Stages run top to bottom. During each stage the number of users changes evenly from where the last stage ended to its own target.</p>
        <div className="grid grid-cols-[2rem_minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-2 text-sm">
          <span className="text-xs text-muted-foreground">#</span>
          <span className="text-xs text-muted-foreground">Length (seconds)</span>
          <span className="text-xs text-muted-foreground">Users at the end</span>
          <span aria-hidden="true" />
          {stages.map((s, i) => {
            const err = errors.get(`load.stages.${i}.durationSec`) ?? errors.get(`load.stages.${i}.target`)
            return (
              <div key={ids[i] ?? i} className="contents">
                <span className="font-mono text-muted-foreground">{i + 1}</span>
                <LoadNumberInput
                  ariaLabel={`Stage ${i + 1} length in seconds`}
                  min={1}
                  value={s.durationSec}
                  invalid={!!errors.get(`load.stages.${i}.durationSec`)}
                  onCommit={(n) => update(i, { durationSec: n })}
                  onBlur={() => update(i, { durationSec: Math.max(1, Math.round(s.durationSec) || 1) })}
                />
                <LoadNumberInput
                  ariaLabel={`Stage ${i + 1} users at the end`}
                  min={0}
                  value={s.target}
                  invalid={!!errors.get(`load.stages.${i}.target`)}
                  onCommit={(n) => update(i, { target: n })}
                  onBlur={() => update(i, { target: Math.max(0, Math.round(s.target) || 0) })}
                />
                <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove stage ${i + 1}`} disabled={stages.length === 1} onClick={() => removeStage(i)}>
                  <XIcon />
                </Button>
                {err && <p className="col-span-4 text-sm text-destructive">{err}</p>}
              </div>
            )
          })}
        </div>
        {!readOnly && (
          <div>
            <Button type="button" variant="outline" size="sm" onClick={addStage}>
              <PlusIcon />
              Add stage
            </Button>
          </div>
        )}
      </section>

      <section className="grid max-w-md gap-2">
        <Label htmlFor="graceful">Wind-down time (seconds)</Label>
        <LoadNumberInput
          id="graceful"
          className="w-32"
          min={0}
          value={load.gracefulStopSec}
          invalid={!!errors.get('load.gracefulStopSec')}
          onCommit={(n) => onChange({ ...load, gracefulStopSec: n })}
          onBlur={() => onChange({ ...load, gracefulStopSec: Math.min(600, Math.max(0, Math.round(load.gracefulStopSec) || 0)) })}
        />
        {errors.get('load.gracefulStopSec') && <p className="text-sm text-destructive">{errors.get('load.gracefulStopSec')}</p>}
        <p className="text-sm text-muted-foreground">After the last stage, requests already on their way get this long to finish before the test stops. 30 suits most tests.</p>
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
          {errors.get('settings.logSamplePct') ?? 'Errors are always logged. Per request and second at most 50 errors, 20 successes and the slowest request are kept.'}
        </p>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="ua">User-Agent</Label>
        <Input id="ua" placeholder="ndswarm/<version>" value={settings.userAgent} aria-invalid={errors.get('settings.userAgent') ? true : undefined} onChange={(e) => onChange({ ...settings, userAgent: e.target.value })} />
        <p className="text-sm text-muted-foreground">{errors.get('settings.userAgent') ?? 'Sent unless a request sets its own header.'}</p>
      </div>
    </div>
  )
}
