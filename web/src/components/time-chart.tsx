import { useTheme } from 'next-themes'
import { useEffect, useRef } from 'react'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import { formatElapsed } from '@/lib/format'

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
}

const cssVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim()

/**
 * One-axis time series (uPlot). Hovering shows a crosshair and the values in the legend,
 * which also names every series, so identity never rests on color alone.
 */
export function TimeChart({ title, data, series, unit = '', height = 200, digits = 1, xMax }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const plot = useRef<uPlot | null>(null)
  const latest = useRef(data)
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
      padding: [8, 8, 0, 0],
      cursor: { points: { size: 8 }, drag: { x: false, y: false } },
      scales: { x: { time: false, ...(xMax ? { range: (): uPlot.Range.MinMax => [0, xMax] } : {}) }, y: { range: (_u, _min, max) => [0, max > 0 ? max * 1.1 : 1] } },
      axes: [
        { stroke: muted, grid: { stroke: grid, width: 1 }, ticks: { show: false }, values: (_u, vals) => vals.map(formatElapsed), font: '11px Geist Mono Variable, monospace' },
        { stroke: muted, grid: { stroke: grid, width: 1 }, ticks: { show: false }, size: 56, values: (_u, vals) => vals.map((v) => `${+v.toFixed(2)}${unit}`), font: '11px Geist Mono Variable, monospace' },
      ],
      legend: { live: true },
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
    u.over.addEventListener('mouseleave', () => u.setLegend({ idx: latest.current[0].length - 1 }))
    u.setLegend({ idx: latest.current[0].length - 1 })
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
    // Without hover, the legend shows the latest second instead of "-".
    if (u.cursor.left == null || u.cursor.left < 0) u.setLegend({ idx: data[0].length - 1 })
  }, [data])

  return (
    <figure className="min-w-0">
      <figcaption className="mb-2 text-sm font-medium">{title}</figcaption>
      <div ref={host} className="ndswarm-chart w-full" role="img" aria-label={`${title} over time`} />
    </figure>
  )
}
