import { createContext, useContext } from 'react'
import type { EnvVar, Field, FieldType, Flow, Generator, Step, Variant } from '@/api/types'

export const uid = () => crypto.randomUUID().slice(0, 8)

export const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const

export function newStep(name: string): Step {
  return {
    id: uid(),
    name,
    enabled: true,
    method: 'GET',
    url: '/',
    query: [],
    headers: [],
    body: { type: 'none', variantPick: 'roundRobin', contentType: '', variants: [] },
    timeoutMs: 30000,
    followRedirects: true,
  }
}

/** An "endpoint" is a flow with exactly one step; names and enabled stay in sync. */
export function newEndpoint(n: number): Flow {
  const name = `Endpoint ${n}`
  return { id: uid(), name, enabled: true, weight: 1, steps: [newStep(name)] }
}

export function newVariant(n: number): Variant {
  return { id: uid(), name: n === 1 ? 'default' : `variant ${n}`, weight: 1, enabled: true, mode: 'fields', fields: [], raw: '' }
}

export function newField(type: FieldType = 'string'): Field {
  return { key: '', type, value: '', children: [] }
}

/** Cloning with fresh ids, used by "Duplicate". */
export function cloneFlow(f: Flow): Flow {
  const c = structuredClone(f)
  c.id = uid()
  c.name = `${f.name} (copy)`
  for (const s of c.steps) {
    s.id = uid()
    s.name = c.name
    for (const v of s.body.variants) v.id = uid()
  }
  return c
}

/** What every nested editor needs: server errors by path, and picker data. */
export interface BuilderCtx {
  errors: Map<string, string>
  environmentId: number | null
  baseUrl: string
  variables: EnvVar[]
  generators: Generator[]
  readOnly: boolean
}

export const BuilderContext = createContext<BuilderCtx>({ errors: new Map(), environmentId: null, baseUrl: '', variables: [], generators: [], readOnly: false })

export const useBuilder = () => useContext(BuilderContext)

/** Error at exactly this path. */
export function useFieldError(path: string): string | undefined {
  return useBuilder().errors.get(path)
}

/** True when any error lives under prefix (for badges on collapsed items). */
export function hasErrorUnder(errors: Map<string, string>, prefix: string): boolean {
  for (const k of errors.keys()) if (k === prefix || k.startsWith(prefix + '.')) return true
  return false
}

const bodyNames: Record<string, string> = { none: 'none', json: 'JSON', form: 'form', multipart: 'multipart form', raw: 'text' }

/** One-line description of a body for folded sections: "JSON, 2 variations". */
export function bodyLabel(b: Step['body']): string {
  if (b.type === 'none') return 'none'
  const n = b.variants.filter((v) => v.enabled).length
  return n > 1 ? `${bodyNames[b.type]}, ${n} variations` : bodyNames[b.type]
}
