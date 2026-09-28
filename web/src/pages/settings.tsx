import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { KeyRoundIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import { useState, type FormEvent, type ReactNode } from 'react'
import { toast } from 'sonner'
import { meKey, useMe } from '@/api/auth'
import { api, ApiError, errorMessage } from '@/api/client'
import type { GuestMode, Role, Settings, SystemInfo, User } from '@/api/types'
import { FormField } from '@/components/form-field'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

const roles: { value: Role; label: string; help: string }[] = [
  { value: 'admin', label: 'Admin', help: 'Everything, including users and settings' },
  { value: 'editor', label: 'Editor', help: 'Create, edit and run tests' },
  { value: 'viewer', label: 'Viewer', help: 'View results only' },
]

export function SettingsPage() {
  const { data: me } = useMe()
  if (!me?.can.admin) {
    return (
      <div className="max-w-md">
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="mt-2 text-sm text-muted-foreground">Only admins can change settings.</p>
      </div>
    )
  }
  return (
    <div className="max-w-4xl space-y-12">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      <UsersSection currentUserId={me.user?.id} />
      <GuestSection />
      <TargetsSection />
      <AboutSection />
    </div>
  )
}

function Section({ title, description, action, children }: { title: string; description: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-medium">{title}</h2>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

const usersKey = ['users'] as const

function UsersSection({ currentUserId }: { currentUserId?: number }) {
  const queryClient = useQueryClient()
  const users = useQuery({ queryKey: usersKey, queryFn: () => api<User[]>('GET', '/users') })
  const [adding, setAdding] = useState(false)
  const [resetting, setResetting] = useState<User | null>(null)
  const [deleting, setDeleting] = useState<User | null>(null)

  const refresh = () => queryClient.invalidateQueries({ queryKey: usersKey })
  const changeRole = useMutation({
    mutationFn: ({ id, role }: { id: number; role: Role }) => api<User>('PATCH', `/users/${id}`, { role }),
    onSuccess: async (u) => {
      toast.success(`${u.username} is now ${u.role}`)
      await refresh()
      if (u.id === currentUserId) await queryClient.invalidateQueries({ queryKey: meKey })
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const remove = useMutation({
    mutationFn: (u: User) => api<void>('DELETE', `/users/${u.id}`),
    onSuccess: async (_, u) => {
      toast.success(`Deleted ${u.username}`)
      setDeleting(null)
      await refresh()
    },
    onError: (e) => toast.error(errorMessage(e)),
  })

  return (
    <Section
      title="Users"
      description="Who can log in and what their role allows."
      action={
        <Button onClick={() => setAdding(true)}>
          <PlusIcon />
          Add user
        </Button>
      }
    >
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Username</TableHead>
              <TableHead className="w-44">Role</TableHead>
              <TableHead className="hidden sm:table-cell">Created</TableHead>
              <TableHead className="w-24 text-right">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.isPending &&
              [0, 1].map((i) => (
                <TableRow key={i}>
                  <TableCell colSpan={4}>
                    <Skeleton className="h-6 w-full" />
                  </TableCell>
                </TableRow>
              ))}
            {users.isError && (
              <TableRow>
                <TableCell colSpan={4} className="text-sm text-destructive">
                  {errorMessage(users.error)}
                </TableCell>
              </TableRow>
            )}
            {users.data?.map((u) => (
              <TableRow key={u.id}>
                <TableCell className="font-medium">
                  {u.username}
                  {u.id === currentUserId && <span className="ml-2 text-xs font-normal text-muted-foreground">(you)</span>}
                </TableCell>
                <TableCell>
                  <Select value={u.role} onValueChange={(role) => changeRole.mutate({ id: u.id, role: role as Role })}>
                    <SelectTrigger size="sm" className="w-32" aria-label={`Role of ${u.username}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {roles.map((r) => (
                        <SelectItem key={r.value} value={r.value}>
                          {r.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell className="hidden text-sm text-muted-foreground sm:table-cell">
                  {new Date(u.createdAt).toLocaleDateString()}
                </TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="icon-sm" aria-label={`Reset password for ${u.username}`} onClick={() => setResetting(u)}>
                    <KeyRoundIcon />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Delete ${u.username}`}
                    disabled={u.id === currentUserId}
                    onClick={() => setDeleting(u)}
                  >
                    <Trash2Icon />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <AddUserDialog open={adding} onOpenChange={setAdding} onCreated={refresh} />
      <ResetPasswordDialog user={resetting} onClose={() => setResetting(null)} />
      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleting?.username}?</AlertDialogTitle>
            <AlertDialogDescription>They are logged out immediately. Runs they started stay in history.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={remove.isPending} onClick={() => deleting && remove.mutate(deleting)}>
              Delete user
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Section>
  )
}

function AddUserDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: () => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<Role>('editor')
  const create = useMutation({
    mutationFn: () => api<User>('POST', '/users', { username, password, role }),
    onSuccess: (u) => {
      toast.success(`Added ${u.username}`)
      onCreated()
      close(false)
    },
  })
  const err = create.error instanceof ApiError ? create.error : null

  function close(o: boolean) {
    onOpenChange(o)
    if (!o) {
      setUsername('')
      setPassword('')
      setRole('editor')
      create.reset()
    }
  }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    create.mutate()
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-5" noValidate>
          <DialogHeader>
            <DialogTitle>Add user</DialogTitle>
            <DialogDescription>Share the username and password with them yourself.</DialogDescription>
          </DialogHeader>
          {create.error && !err?.details.length && <p className="text-sm text-destructive">{errorMessage(create.error)}</p>}
          <FormField id="new-username" label="Username" autoComplete="off" value={username} onChange={(e) => setUsername(e.target.value)} error={err?.field('username')} />
          <FormField
            id="new-password"
            label="Password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={err?.field('password')}
            hint="At least 8 characters."
          />
          <div className="grid gap-2">
            <Label htmlFor="new-role">Role</Label>
            <Select value={role} onValueChange={(r) => setRole(r as Role)}>
              <SelectTrigger id="new-role" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {roles.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {r.label}
                    <span className="text-muted-foreground">{r.help}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => close(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending || !username || !password}>
              Add user
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ResetPasswordDialog({ user, onClose }: { user: User | null; onClose: () => void }) {
  const [password, setPassword] = useState('')
  const reset = useMutation({
    mutationFn: () => api<User>('PATCH', `/users/${user?.id}`, { password }),
    onSuccess: (u) => {
      toast.success(`Password changed for ${u.username}. Their other sessions were logged out.`)
      close()
    },
  })
  const err = reset.error instanceof ApiError ? reset.error : null

  function close() {
    setPassword('')
    reset.reset()
    onClose()
  }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    reset.mutate()
  }

  return (
    <Dialog open={user !== null} onOpenChange={(o) => !o && close()}>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-5" noValidate>
          <DialogHeader>
            <DialogTitle>Reset password for {user?.username}</DialogTitle>
            <DialogDescription>Their other sessions end when you save.</DialogDescription>
          </DialogHeader>
          {reset.error && !err?.details.length && <p className="text-sm text-destructive">{errorMessage(reset.error)}</p>}
          <FormField
            id="reset-password"
            label="New password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={err?.field('password')}
            hint="At least 8 characters."
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" disabled={reset.isPending || !password}>
              Save password
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

const guestModes: { value: GuestMode; label: string; help: string }[] = [
  { value: 'off', label: 'Off', help: 'Everyone must log in.' },
  { value: 'view', label: 'View', help: 'Anyone who can reach this server sees the dashboard, runs and logs. Secrets stay hidden.' },
  { value: 'run', label: 'View and run', help: 'Like View, and guests can also start existing tests. They cannot edit them.' },
]

function GuestSection() {
  const queryClient = useQueryClient()
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api<Settings>('GET', '/settings') })
  const save = useMutation({
    mutationFn: (guestMode: GuestMode) => api<Settings>('PATCH', '/settings', { guestMode }),
    onSuccess: (s) => {
      queryClient.setQueryData(['settings'], s)
      void queryClient.invalidateQueries({ queryKey: meKey })
      toast.success(`Guest access: ${guestModes.find((g) => g.value === s.guestMode)?.label}`)
    },
    onError: (e) => toast.error(errorMessage(e)),
  })

  return (
    <Section title="Guest access" description="What people can do without logging in.">
      {settings.isPending ? (
        <Skeleton className="h-36 w-full" />
      ) : settings.isError ? (
        <p className="text-sm text-destructive">{errorMessage(settings.error)}</p>
      ) : (
        <RadioGroup
          value={save.isPending ? save.variables : settings.data.guestMode}
          onValueChange={(v) => save.mutate(v as GuestMode)}
          className="gap-0 divide-y rounded-lg border"
        >
          {guestModes.map((g) => (
            <Label key={g.value} htmlFor={`guest-${g.value}`} className="flex cursor-pointer items-start gap-3 p-4 font-normal">
              <RadioGroupItem
                id={`guest-${g.value}`}
                value={g.value}
                aria-label={g.label}
                aria-describedby={`guest-${g.value}-help`}
                className="mt-0.5"
              />
              <span className="grid gap-1">
                <span className="font-medium">{g.label}</span>
                <span id={`guest-${g.value}-help`} className="text-sm text-muted-foreground">
                  {g.help}
                </span>
              </span>
            </Label>
          ))}
        </RadioGroup>
      )}
    </Section>
  )
}

function TargetsSection() {
  const queryClient = useQueryClient()
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api<Settings>('GET', '/settings') })
  return (
    <Section title="Targets and retention" description="Limits that apply to every test and run on this server.">
      {settings.isPending ? (
        <Skeleton className="h-48 w-full" />
      ) : settings.isError ? (
        <p className="text-sm text-destructive">{errorMessage(settings.error)}</p>
      ) : (
        <TargetsForm key={JSON.stringify(settings.data)} initial={settings.data} onSaved={(s) => queryClient.setQueryData(['settings'], s)} />
      )}
    </Section>
  )
}

function TargetsForm({ initial, onSaved }: { initial: Settings; onSaved: (s: Settings) => void }) {
  const [allowlist, setAllowlist] = useState(initial.targetAllowlist.join('\n'))
  const [linkLocal, setLinkLocal] = useState(initial.allowLinkLocal)
  const [retention, setRetention] = useState(String(initial.retentionDays))
  const save = useMutation({
    mutationFn: () =>
      api<Settings>('PATCH', '/settings', {
        targetAllowlist: allowlist.split(/[\s,]+/).filter(Boolean),
        allowLinkLocal: linkLocal,
        retentionDays: Number(retention),
      }),
    onSuccess: (s) => {
      onSaved(s)
      toast.success('Settings saved')
    },
  })
  const err = save.error instanceof ApiError ? save.error : null
  const hostErr = err?.details.find((d) => d.path.startsWith('targetAllowlist'))?.message
  const submit = (e: FormEvent) => {
    e.preventDefault()
    save.mutate()
  }
  return (
    <form onSubmit={submit} className="grid max-w-2xl gap-6" noValidate>
      {save.error && !err?.details.length && <p className="text-sm text-destructive">{errorMessage(save.error)}</p>}
      <div className="grid gap-2">
        <Label htmlFor="allowlist">Allowed target hosts</Label>
        <Textarea id="allowlist" rows={4} className="font-mono text-[13px]" placeholder={'api.example.com\n*.staging.example.com'} value={allowlist} aria-invalid={hostErr ? true : undefined} onChange={(e) => setAllowlist(e.target.value)} />
        <p className={hostErr ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}>
          {hostErr ?? 'One host per line. Leave empty to allow any host. Applies to runs, preflight and Try.'}
        </p>
      </div>
      <label className="flex items-start gap-3">
        <Switch className="mt-0.5" checked={linkLocal} onCheckedChange={setLinkLocal} />
        <span className="grid gap-0.5">
          <span className="text-sm font-medium">Allow link-local addresses</span>
          <span className="text-sm text-muted-foreground">Off by default, so tests cannot reach cloud metadata such as 169.254.169.254.</span>
        </span>
      </label>
      <FormField
        id="retention"
        label="Keep logged requests for (days)"
        type="number"
        min={1}
        className="w-32 font-mono"
        value={retention}
        onChange={(e) => setRetention(e.target.value)}
        error={err?.field('retentionDays')}
        hint="Older request logs are deleted daily. Run metrics and summaries are kept until the run is deleted."
      />
      <div>
        <Button type="submit" disabled={save.isPending}>
          Save
        </Button>
      </div>
    </form>
  )
}

function AboutSection() {
  const system = useQuery({ queryKey: ['system'], queryFn: () => api<SystemInfo>('GET', '/system') })
  const rows: [string, string][] = system.data
    ? [
        ['Version', system.data.version],
        ['Go', system.data.goVersion],
        ['CPUs', String(system.data.cpus)],
        ['Memory', `${system.data.memMB} MB`],
        ['Uptime', formatUptime(system.data.uptimeSec)],
      ]
    : []

  return (
    <Section title="About" description="This ndswarm server.">
      {system.isPending ? (
        <Skeleton className="h-24 w-full max-w-sm" />
      ) : system.isError ? (
        <p className="text-sm text-destructive">{errorMessage(system.error)}</p>
      ) : (
        <dl className="grid max-w-sm grid-cols-[8rem_1fr] gap-y-2 text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="font-mono">{v}</dd>
            </div>
          ))}
        </dl>
      )}
    </Section>
  )
}

function formatUptime(sec: number): string {
  const d = Math.floor(sec / 86400)
  const h = Math.floor((sec % 86400) / 3600)
  const m = Math.floor((sec % 3600) / 60)
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m ${sec % 60}s`
}
