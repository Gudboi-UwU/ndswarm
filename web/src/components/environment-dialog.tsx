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
    mutationFn: () => (env ? api<Environment>('PUT', `/environments/${env.id}`, draft) : api<Environment>('POST', `/projects/${projectId}/environments`, draft)),
    onSuccess: async (e) => {
      await queryClient.invalidateQueries({ queryKey: keys.environments(projectId) })
      toast.success(env ? `Saved ${e.name}` : `Created ${e.name}`)
      onOpenChange(false)
    },
  })
  const err = save.error instanceof ApiError ? save.error : null
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }))
  const setAuth = (patch: Partial<Draft['auth']>) => setDraft((d) => ({ ...d, auth: { ...d.auth, ...patch } }))

  const submit = (e: FormEvent) => {
    e.preventDefault()
    save.mutate()
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
              label="Base URL"
              placeholder="https://api.example.com"
              value={draft.baseUrl}
              onChange={(e) => set({ baseUrl: e.target.value })}
              error={err?.field('baseUrl')}
              hint="Endpoint paths like /orders are joined to this."
            />
          </div>

          <PairList
            title="Variables"
            hint={'Use in any value as {{var "name"}}.'}
            keyLabel="Name"
            items={draft.variables}
            onChange={(variables) => set({ variables })}
            errorAt={(i, f) => err?.field(`variables.${i}.${f}`)}
          />
          <PairList
            title="Default headers"
            hint="Sent with every request. A step can override them."
            keyLabel="Header"
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
  items,
  onChange,
  errorAt,
}: {
  title: string
  hint: string
  keyLabel: string
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
        <div className="grid grid-cols-[1fr_1.4fr_auto_auto] items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span>{keyLabel}</span>
          <span>Value</span>
          <span>Secret</span>
          <span aria-hidden="true" />
          {items.map((it, i) => {
            const keyErr = errorAt(i, 'key')
            const valErr = errorAt(i, 'value')
            return (
              <div key={i} className="contents">
                <Input aria-label={`${keyLabel} ${i + 1}`} value={it.key} aria-invalid={keyErr ? true : undefined} onChange={(e) => update(i, { key: e.target.value })} />
                <Input
                  aria-label={`Value ${i + 1}`}
                  type={it.secret ? 'password' : 'text'}
                  value={it.value}
                  aria-invalid={valErr ? true : undefined}
                  onChange={(e) => update(i, { value: e.target.value })}
                />
                <Switch aria-label={`Secret ${i + 1}`} checked={it.secret} onCheckedChange={(secret) => update(i, { secret })} />
                <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove ${it.key || 'row'}`} onClick={() => onChange(items.filter((_, j) => j !== i))}>
                  <XIcon />
                </Button>
                {(keyErr || valErr) && <p className="col-span-4 text-sm text-destructive">{keyErr ?? valErr}</p>}
              </div>
            )
          })}
        </div>
      )}
      <div>
        <Button type="button" variant="outline" size="sm" onClick={() => onChange([...items, { key: '', value: '', secret: false }])}>
          <PlusIcon />
          Add {keyLabel.toLowerCase()}
        </Button>
      </div>
    </fieldset>
  )
}
