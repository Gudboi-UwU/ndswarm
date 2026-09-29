// How the total row of a table combines its rows.
export type AggMode = 'combined' | 'sum' | 'mean' | 'median' | 'max' | 'min'

export const aggModes: { value: AggMode; label: string; help: string }[] = [
  {
    value: 'combined',
    label: 'All requests combined',
    help: 'Every request together, as if they were one. Each row weighs as much as it ran: a request sent 10 times more often counts 10 times more. Percentiles come from the full distribution. This is what the server delivered overall.',
  },
  {
    value: 'sum',
    label: 'Sum of rows',
    help: 'Adds the rows. For counts this is the total. For times it is how long one user waits to send each request once, one after another.',
  },
  {
    value: 'mean',
    label: 'Average of rows',
    help: 'The plain average of the rows: every request counts the same, however often it ran.',
  },
  {
    value: 'median',
    label: 'Median of rows',
    help: 'The middle value of the rows: half of the requests are above it, half below. Not pulled up by one slow request.',
  },
  { value: 'max', label: 'Highest row (worst)', help: 'The highest value of any row, for example the slowest request type.' },
  { value: 'min', label: 'Lowest row (best)', help: 'The lowest value of any row, for example the fastest request type.' },
]

/** Combines row values; "combined" is not a row statistic and must be computed by the caller. */
export function aggregate(values: number[], mode: Exclude<AggMode, 'combined'>): number {
  if (values.length === 0) return 0
  switch (mode) {
    case 'sum':
      return values.reduce((a, b) => a + b, 0)
    case 'mean':
      return values.reduce((a, b) => a + b, 0) / values.length
    case 'median': {
      const s = [...values].sort((a, b) => a - b)
      const m = s.length >> 1
      return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
    }
    case 'max':
      return Math.max(...values)
    case 'min':
      return Math.min(...values)
  }
}

const storageKey = 'ndswarm.aggMode'

/** Remembers the viewer's last choice in this browser; falls back quietly when storage is blocked. */
export function savedAggMode(): AggMode {
  try {
    const v = localStorage.getItem(storageKey)
    if (aggModes.some((m) => m.value === v)) return v as AggMode
  } catch {
    // private mode or blocked storage
  }
  return 'combined'
}

export function saveAggMode(mode: AggMode) {
  try {
    localStorage.setItem(storageKey, mode)
  } catch {
    // not important enough to report
  }
}
