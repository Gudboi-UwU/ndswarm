export type SortDir = 'asc' | 'desc'
export interface SortState<K extends string> {
  key: K
  dir: SortDir
}

/** Sorts a copy of rows by a value getter; nulls last. */
export function sortRows<T, K extends string>(rows: T[], sort: SortState<K>, get: (row: T, key: K) => number | string | null | undefined): T[] {
  const dir = sort.dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    const x = get(a, sort.key)
    const y = get(b, sort.key)
    if (x == null) return 1
    if (y == null) return -1
    return (typeof x === 'string' ? x.localeCompare(String(y)) : x - (y as number)) * dir
  })
}
