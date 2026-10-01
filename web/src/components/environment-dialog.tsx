import { useMutation, useQueryClient } from '@tanstack/react-query'
import { PlusIcon, XIcon } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { api, ApiError, errorMessage } from '@/api/client'
import { keys } from '@/api/keys'
import type { AuthType, Environment, EnvVar } from '@/api/types'
import { FormField } from '@/components/form-field'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'

type Draft = Omit<Environment, 'id' | 'projectId'>

const blank: Draft = { name: '', baseUrl: '', variables: [], headers: [], auth: { type: 'none' } }

/** Create (no `env`) or edit an environment. Mount with a `key` so the draft resets per environment. */
export function EnvironmentDialog({
  projectId,
  env,
  open,
  onOpenChange,
}: {
  projectId: number
  env?: Environment
  open: boolean
  onOpenChange: (o: boolean) => void
}) {
  const [draft, setDraft] = useState<Draft>(() => (env ? structuredClone(env) : structuredClone(blank)))
  const queryClient = useQueryClient()
  const save = useMutation({
    mutationFn: (d: Draft) => (env ? api<Environment>('PUT', `/environments/${env.id}`, d) : api<Environment>('POST', `/projects/${projectId}/environments`, d)),
    onSuccess: async (e) => {
      await queryClient.invalidateQueries({ queryKey: keys.environments(projectId) })
      // The project's tests show this server's address, so they need refreshing too.
      await queryClient.invalidateQueries({ queryKey: keys.tests(projectId) })
      // A builder open on a test using this server has its template check cached by flows +
      // environmentId only, so a variable/baseUrl/auth edit here would otherwise look stale there.
      await queryClient.invalidateQueries({ queryKey: ['check'] })
      toast.success(env ? `Saved ${e.name}` : `Created ${e.name}`)
      onOpenChange(false)
    },
  })
  const err = save.error instanceof ApiError ? save.error : null
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }))
  const setAuth = (patch: Partial<Draft['auth']>) => setDraft((d) => ({ ...d, auth: { ...d.auth, ...patch } }))

  const submit = (e: FormEvent) => {
    e.preventDefault()
    // Rows left completely empty are dropped instead of blocking the save with a name error.
    const filled = (v: EnvVar) => v.key.trim() !== '' || v.value.trim() !== ''
    const clean = { ...draft, variables: draft.variables.filter(filled), headers: draft.headers.filter(filled) }
    setDraft(clean)
    save.mutate(clean)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <form onSubmit={submit} className="grid gap-6" noValidate>
          <DialogHeader>
            <DialogTitle>{env ? `Edit ${env.name}` : 'New server'}</DialogTitle>
            <DialogDescription>The server you want to test, plus values shared by its tests. Secret values are encrypted and never shown again.</DialogDescription>
          </DialogHeader>
          {save.error && !err?.details.length && <p className="text-sm text-destructive">{errorMessage(save.error)}</p>}
          <div className="grid gap-5 sm:grid-cols-2">
            <FormField id="env-name" label="Name" placeholder="Staging API" value={draft.name} onChange={(e) => set({ name: e.target.value })} error={err?.field('name')} />
            <FormField
              id="env-base"
              label="Server address"
              placeholder="https://api.example.com"
              value={draft.baseUrl}
              onChange={(e) => set({ baseUrl: e.target.value })}
              error={err?.field('baseUrl')}
              hint="Request paths like /orders are joined to this."
            />
          </div>

          <PairList
            title="Variables"
            hint={'Use in any value as {{var "name"}}.'}
            keyLabel="Name"
            addLabel="Add variable"
            items={draft.variables}
            onChange={(variables) => set({ variables })}
            errorAt={(i, f) => err?.field(`variables.${i}.${f}`)}
          />
          <PairList
            title="Default headers"
            hint="Sent with every request. A request can override them."
            keyLabel="Header"
            addLabel="Add header"
            items={draft.headers}
            onChange={(headers) => set({ headers })}
            errorAt={(i, f) => err?.field(`headers.${i}.${f}`)}
          />

          <fieldset className="grid gap-3">
            <legend className="mb-1 text-sm font-medium">Authentication</legend>
            <Select value={draft.auth.type} onValueChange={(type) => setAuth({ type: type as AuthType })}>
              <SelectTrigger className="w-56" aria-label="Authentication type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                <SelectItem value="bearer">Bearer token</SelectItem>
                <SelectItem value="basic">Basic (username and password)</SelectItem>
                <SelectItem value="apiKey">API key header</SelectItem>
              </SelectContent>
            </Select>
            {draft.auth.type === 'bearer' && (
              <FormField id="auth-token" label="Token" type="password" value={draft.auth.token ?? ''} onChange={(e) => setAuth({ token: e.target.value })} error={err?.field('auth.token')} />
            )}
            {draft.auth.type === 'basic' && (
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField id="auth-user" label="Username" value={draft.auth.username ?? ''} onChange={(e) => setAuth({ username: e.target.value })} error={err?.field('auth.username')} />
                <FormField id="auth-pass" label="Password" type="password" value={draft.auth.password ?? ''} onChange={(e) => setAuth({ password: e.target.value })} error={err?.field('auth.password')} />
              </div>
            )}
            {draft.auth.type === 'apiKey' && (
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField id="auth-header" label="Header name" placeholder="X-Api-Key" value={draft.auth.header ?? ''} onChange={(e) => setAuth({ header: e.target.value })} error={err?.field('auth.header')} />
                <FormField id="auth-value" label="Key" type="password" value={draft.auth.value ?? ''} onChange={(e) => setAuth({ value: e.target.value })} error={err?.field('auth.value')} />
              </div>
            )}
          </fieldset>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending || !draft.name.trim()}>
              {env ? 'Save' : 'Add server'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function PairList({
  title,
  hint,
  keyLabel,
  addLabel,
  items,
  onChange,
  errorAt,
}: {
  title: string
  hint: string
  keyLabel: string
  addLabel: string
  items: EnvVar[]
  onChange: (items: EnvVar[]) => void
  errorAt: (i: number, field: 'key' | 'value') => string | undefined
}) {
  const update = (i: number, patch: Partial<EnvVar>) => onChange(items.map((it, j) => (j === i ? { ...it, ...patch } : it)))
  return (
    <fieldset className="grid gap-2">
      <legend className="text-sm font-medium">{title}</legend>
      <p className="text-sm text-muted-foreground">{hint}</p>
      {items.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-[1fr_1.4fr_auto_auto] sm:items-center sm:gap-x-2 sm:gap-y-1">
          <span className="hidden text-xs text-muted-foreground sm:block">{keyLabel}</span>
          <span className="hidden text-xs text-muted-foreground sm:block">Value</span>
          <span className="hidden text-xs text-muted-foreground sm:block">Secret</span>
          <span aria-hidden="true" className="hidden sm:block" />
          {items.map((it, i) => {
            const keyErr = errorAt(i, 'key')
            const valErr = errorAt(i, 'value')
            return (
              <div key={i} className="grid gap-2 rounded-md border p-3 sm:contents sm:border-0 sm:p-0">
                <Input aria-label={`${keyLabel} ${i + 1}`} value={it.key} aria-invalid={keyErr ? true : undefined} onChange={(e) => update(i, { key: e.target.value })} />
                <Input
                  aria-label={`Value ${i + 1}`}
                  type={it.secret ? 'password' : 'text'}
                  value={it.value}
                  aria-invalid={valErr ? true : undefined}
                  onChange={(e) => update(i, { value: e.target.value })}
                />
                <div className="flex items-center justify-between gap-2 sm:contents">
                  <label className="flex items-center gap-2 text-sm text-muted-foreground sm:contents">
                    <Switch aria-label={`Secret ${i + 1}`} checked={it.secret} onCheckedChange={(secret) => update(i, { secret })} />
                    <span className="sm:hidden">Secret</span>
                  </label>
                  <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove ${it.key || 'row'}`} onClick={() => onChange(items.filter((_, j) => j !== i))}>
                    <XIcon />
                  </Button>
                </div>
                {(keyErr || valErr) && <p className="text-sm text-destructive sm:col-span-4">{keyErr ?? valErr}</p>}
              </div>
            )
          })}
        </div>
      )}
      <div>
        <Button type="button" variant="outline" size="sm" onClick={() => onChange([...items, { key: '', value: '', secret: false }])}>
          <PlusIcon />
          {addLabel}
        </Button>
      </div>
    </fieldset>
  )
}
