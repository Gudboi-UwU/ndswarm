import { useTheme } from 'next-themes'
import { useEffect, useRef, useState } from 'react'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import { formatElapsed } from '@/lib/format'
import { cn } from '@/lib/utils'

export interface ChartSeries {
  label: string
  /** CSS color, or a pair for [light, dark] when the step differs per mode. */
  color: string | [string, string]
  width?: number
  fill?: boolean
}

interface Props {
  title: string
  /** x values (seconds since start) followed by one array per series. */
  data: [number[], ...(number | null)[][]]
  series: ChartSeries[]
  unit?: string
  height?: number
  /** Round y values in the legend. */
  digits?: number
  /** Fix the x axis to 0..xMax (a live run's planned length) instead of fitting the data. */
  xMax?: number
  /** Called with the x value (second) of a clicked point. */
  onPick?: (x: number) => void
  /** Live data: the idle legend shows the latest second. Otherwise it shows the average. */
  live?: boolean
}

const cssVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim()

/**
 * One-axis time series (uPlot). Hovering shows a crosshair and the values in the legend,
 * which also names every series, so identity never rests on color alone.
 */
export function TimeChart({ title, data, series, unit = '', height = 200, digits = 1, xMax, onPick, live = true }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const plot = useRef<uPlot | null>(null)
  const latest = useRef(data)
  const [hover, setHover] = useState<number | null>(null)
  const pick = useRef(onPick)
  useEffect(() => {
    pick.current = onPick
  })
  const { resolvedTheme } = useTheme()
  const dark = resolvedTheme !== 'light'

  // Rebuild on theme or shape change; data updates go through setData below.
  useEffect(() => {
    const el = host.current
    if (!el) return
    const muted = cssVar('--muted-foreground')
    const grid = cssVar('--border')
    const fmt = (v: number | null) => (v == null ? '-' : `${v.toFixed(digits)}${unit}`)
    const opts: uPlot.Options = {
      width: el.clientWidth,
      height,
      // Right padding is wider than the rest: the last x-axis label (e.g. "0:15") is anchored
      // at its tick, so without room past it the label gets clipped by the canvas edge.
      padding: [8, 28, 0, 0],
      cursor: { points: { size: 8 }, drag: { x: false, y: false } },
      scales: { x: { time: false, ...(xMax ? { range: (): uPlot.Range.MinMax => [0, xMax] } : {}) }, y: { range: (_u, _min, max) => [0, max > 0 ? max * 1.1 : 1] } },
      axes: [
        { stroke: muted, grid: { stroke: grid, width: 1 }, ticks: { show: false }, values: (_u, vals) => vals.map(formatElapsed), font: '11px Geist Mono Variable, monospace' },
        { stroke: muted, grid: { stroke: grid, width: 1 }, ticks: { show: false }, size: 56, values: (_u, vals) => vals.map((v) => `${+v.toFixed(2)}${unit}`), font: '11px Geist Mono Variable, monospace' },
      ],
      legend: { show: false },
      hooks: { setCursor: [(u) => setHover(u.cursor.idx ?? null)] },
      series: [
        { label: 'Time', value: (_u, v) => (v == null ? '-' : formatElapsed(v)) },
        ...series.map((s) => {
          const color = Array.isArray(s.color) ? s.color[dark ? 1 : 0] : s.color.startsWith('--') ? cssVar(s.color) : s.color
          return {
            label: s.label,
            stroke: color,
            width: s.width ?? 2,
            fill: s.fill ? `color-mix(in oklab, ${color} 14%, transparent)` : undefined,
            points: { show: false },
            spanGaps: false,
            value: (_u: uPlot, v: number | null) => fmt(v),
          }
        }),
      ],
    }
    const u = new uPlot(opts, latest.current as uPlot.AlignedData, el)
    u.over.addEventListener('click', () => {
      const idx = u.cursor.idx
      if (idx != null && pick.current) pick.current(latest.current[0][idx])
    })
    plot.current = u
    const ro = new ResizeObserver(() => plot.current?.setSize({ width: el.clientWidth, height }))
    ro.observe(el)
    return () => {
      ro.disconnect()
      plot.current?.destroy()
      plot.current = null
    }
    // series must be a stable (module-level) array; data flows in through setData below
  }, [dark, height, unit, digits, series, xMax])

  useEffect(() => {
    latest.current = data
    const u = plot.current
    if (!u) return
    u.setData(data as uPlot.AlignedData)
  }, [data])

  return (
    <figure className="min-w-0">
      <figcaption className="mb-2 grid gap-1">
        <span className="text-sm font-medium">{title}</span>
        <Legend data={data} series={series} idx={hover} unit={unit} digits={digits} dark={dark} live={live} />
      </figcaption>
      <div ref={host} className={cn('ndswarm-chart w-full', onPick && '[&_.u-over]:cursor-pointer')} role="img" aria-label={`${title} over time`} />
    </figure>
  )
}

/** Series names with their value: the hovered point, or the latest one. Always readable, never "-". */
function Legend({ data, series, idx, unit, digits, dark, live }: { data: Props['data']; series: ChartSeries[]; idx: number | null; unit: string; digits: number; dark: boolean; live: boolean }) {
  const n = data[0].length
  const at = idx ?? n - 1
  if (n === 0) return <span className="text-xs text-muted-foreground">No data yet.</span>
  const average = (col: (number | null)[]) => {
    const vals = col.filter((v): v is number => v != null)
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null
  }
  const label = idx !== null ? `at ${formatElapsed(data[0][at])}` : live ? 'latest' : 'average'
  return (
    <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <span className="font-mono tabular-nums">{label}</span>
      {series.map((s, i) => {
        const v = idx === null && !live ? average(data[i + 1] ?? []) : data[i + 1]?.[at]
        const color = Array.isArray(s.color) ? s.color[dark ? 1 : 0] : s.color.startsWith('--') ? `var(${s.color})` : s.color
        return (
          <span key={s.label} className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm" style={{ background: color }} aria-hidden="true" />
            {s.label}
            <span className="font-mono text-foreground tabular-nums">{v == null ? 'no data' : `${v.toFixed(digits)}${unit}`}</span>
          </span>
        )
      })}
    </span>
  )
}
