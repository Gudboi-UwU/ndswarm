import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CopyIcon, PencilIcon, PlusIcon, RouteIcon, Trash2Icon } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useBlocker, useParams } from 'react-router'
import { toast } from 'sonner'
import { useMe } from '@/api/auth'
import { api, ApiError, errorMessage } from '@/api/client'
import { keys } from '@/api/keys'
import type { Environment, Flow, Generator, Project, Test } from '@/api/types'
import { ConfirmDelete, EmptyState } from '@/components/page'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { NotFoundPage } from '../not-found'
import { BuilderContext, cloneFlow, hasErrorUnder, newEndpoint } from './draft'
import { LoadEditor, SettingsEditor } from './load-editor'
import { StartButton } from './start-button'
import { EndpointEditor } from './step-editor'

const noErrors = new Map<string, string>()

export default function TestBuilderPage() {
  const id = Number(useParams().id)
  const test = useQuery({ queryKey: keys.test(id), queryFn: () => api<Test>('GET', `/tests/${id}`) })

  if (test.error instanceof ApiError && test.error.status === 404) return <NotFoundPage />
  if (test.isError) return <p className="text-sm text-destructive">{errorMessage(test.error)}</p>
  if (test.isPending) return <BuilderSkeleton />
  return <Builder key={test.data.id} saved={test.data} />
}

function BuilderSkeleton() {
  return (
    <div className="grid gap-6">
      <Skeleton className="h-9 w-80" />
      <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
        <Skeleton className="h-64" />
        <Skeleton className="h-96" />
      </div>
    </div>
  )
}

function Builder({ saved }: { saved: Test }) {
  const { data: me } = useMe()
  const readOnly = !me?.can.edit
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<Test>(() => structuredClone(saved))
  const [baseline, setBaseline] = useState(() => JSON.stringify(saved))
  const [selected, setSelected] = useState(0)
  const [errors, setErrors] = useState<Map<string, string>>(new Map())
  const [deleting, setDeleting] = useState<number | null>(null)
  const [tab, setTab] = useState('endpoints')
  const dirty = JSON.stringify(draft) !== baseline
  // The saved version was valid, so errors only matter while there are changes.
  const shownErrors = dirty ? errors : noErrors

  const project = useQuery({ queryKey: keys.project(saved.projectId), queryFn: () => api<Project>('GET', `/projects/${saved.projectId}`) })
  const envs = useQuery({ queryKey: keys.environments(saved.projectId), queryFn: () => api<Environment[]>('GET', `/projects/${saved.projectId}/environments`) })
  const generators = useQuery({ queryKey: keys.generators, queryFn: () => api<Generator[]>('GET', '/tools/generators'), staleTime: Infinity })
  const env = envs.data?.find((e) => e.id === draft.environmentId)

  const save = useMutation({
    mutationFn: () => api<Test>('PUT', `/tests/${saved.id}`, draft),
    onSuccess: async (t) => {
      setBaseline(JSON.stringify({ ...draft, updatedAt: t.updatedAt }))
      setDraft((d) => ({ ...d, updatedAt: t.updatedAt }))
      setErrors(new Map())
      queryClient.setQueryData(keys.test(t.id), t)
      await queryClient.invalidateQueries({ queryKey: keys.tests(saved.projectId) })
      toast.success('Test saved')
    },
    onError: (e) => {
      if (e instanceof ApiError && e.details.length) {
        setErrors(new Map(e.details.map((d) => [d.path, d.message])))
        const first = e.details.map((d) => /^flows\.(\d+)/.exec(d.path)).find(Boolean)
        if (first) setSelected(Number(first[1]))
        const area = e.details[0].path.split('.')[0]
        setTab(area === 'load' ? 'load' : area === 'settings' ? 'settings' : 'endpoints')
        toast.error(`Not saved: ${e.details.length} field(s) need attention.`)
      } else {
        toast.error(errorMessage(e))
      }
    },
  })

  // Ctrl/Cmd+S saves; leaving with unsaved changes asks first.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        if (dirty && !readOnly && !save.isPending) save.mutate()
      }
    }
    const onUnload = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('beforeunload', onUnload)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('beforeunload', onUnload)
    }
  }, [dirty, readOnly, save])
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname)

  const flows = draft.flows
  const setFlows = (next: Flow[]) => setDraft((d) => ({ ...d, flows: next }))
  const totalWeight = flows.reduce((sum, f) => sum + (f.enabled ? f.weight : 0), 0)
  const share = (f: Flow) => (f.enabled && totalWeight > 0 ? (f.weight / totalWeight) * 100 : null)
  const sel = Math.min(selected, flows.length - 1)

  const add = () => {
    setFlows([...flows, newEndpoint(flows.length + 1)])
    setSelected(flows.length)
  }
  const ctx = useMemo(
    () => ({ errors: shownErrors, environmentId: draft.environmentId, baseUrl: env?.baseUrl ?? '', variables: env?.variables ?? [], generators: generators.data ?? [], readOnly }),
    [shownErrors, draft.environmentId, env, generators.data, readOnly],
  )

  return (
    <BuilderContext.Provider value={ctx}>
      <div className="grid gap-6">
        <header className="grid gap-3">
          <nav className="text-sm text-muted-foreground">
            <Link to="/projects" className="hover:text-foreground">
              Projects
            </Link>
            {' / '}
            <Link to={`/projects/${saved.projectId}`} className="hover:text-foreground">
              {project.data?.name ?? '...'}
            </Link>
          </nav>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center">
            <Input
              aria-label="Test name"
              value={draft.name}
              readOnly={readOnly}
              aria-invalid={shownErrors.get('name') ? true : undefined}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              title="Click to rename"
              className="peer h-10 max-w-md border-transparent bg-transparent px-2 text-xl font-semibold shadow-none hover:border-input focus-visible:border-ring dark:bg-transparent"
            />
            {!readOnly && <PencilIcon className="-ml-1 size-4 text-muted-foreground peer-focus-visible:hidden" aria-hidden="true" />}
            </div>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              Server
            <Select
              value={draft.environmentId === null ? 'none' : String(draft.environmentId)}
              // Radix reports "" while the chosen option is not rendered yet (environments still loading).
              onValueChange={(v) => v && setDraft((d) => ({ ...d, environmentId: v === 'none' ? null : Number(v) }))}
              disabled={readOnly}
            >
              <SelectTrigger aria-label="Server" className="w-72">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None: every request has a full URL</SelectItem>
                {envs.data?.map((e) => (
                  <SelectItem key={e.id} value={String(e.id)}>
                    {e.baseUrl && !e.baseUrl.includes(e.name) ? `${e.name} (${e.baseUrl})` : e.baseUrl || e.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            </label>
            <div className="ml-auto flex items-center gap-3">
              <Button variant="ghost" size="sm" asChild>
                <Link to={`/runs?testId=${saved.id}`}>Past runs</Link>
              </Button>
              {readOnly ? (
                !me?.can.run && <span className="text-sm text-muted-foreground">Read only</span>
              ) : (
                <Button variant="outline" onClick={() => save.mutate()} disabled={!dirty || save.isPending}>
                  {save.isPending ? 'Saving' : dirty ? 'Save' : 'Saved'}
                </Button>
              )}
              {me?.can.run && (
                <StartButton
                  testId={saved.id}
                  blockedReason={flows.length === 0 ? 'Add a request first.' : undefined}
                  // Running always uses the saved test, so unsaved edits are saved first.
                  beforeStart={dirty && !readOnly ? async () => (await save.mutateAsync().then(() => true, () => false)) : undefined}
                />
              )}
            </div>
          </div>
          {shownErrors.get('name') && <p className="text-sm text-destructive">{shownErrors.get('name')}</p>}
          {env && !env.baseUrl && <p className="text-sm text-muted-foreground">{env.name} has no address, so every request needs a full URL.</p>}
        </header>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="endpoints" className={cn(hasErrorUnder(shownErrors, 'flows') && 'text-destructive')}>
              Requests
            </TabsTrigger>
            <TabsTrigger value="load" className={cn(hasErrorUnder(shownErrors, 'load') && 'text-destructive')}>
              Load
            </TabsTrigger>
            <TabsTrigger value="settings" className={cn(hasErrorUnder(shownErrors, 'settings') && 'text-destructive')}>
              Options
            </TabsTrigger>
          </TabsList>
          <TabsContent value="load" className="mt-6">
            <fieldset disabled={readOnly} className="min-w-0 max-w-3xl">
              <legend className="sr-only">Load</legend>
              <LoadEditor load={draft.load} onChange={(load) => setDraft((d) => ({ ...d, load }))} />
            </fieldset>
          </TabsContent>
          <TabsContent value="settings" className="mt-6">
            <fieldset disabled={readOnly} className="min-w-0">
              <legend className="sr-only">HTTP settings</legend>
              <SettingsEditor settings={draft.settings} onChange={(settings) => setDraft((d) => ({ ...d, settings }))} />
            </fieldset>
          </TabsContent>
          <TabsContent value="endpoints" className="mt-6">
        {flows.length === 0 ? (
          <EmptyState
            icon={<RouteIcon />}
            title="No requests yet"
            action={
              !readOnly && (
                <Button onClick={add}>
                  <PlusIcon />
                  Add a request
                </Button>
              )
            }
          >
            Add the requests your users make, such as opening a page or creating an order.
          </EmptyState>
        ) : (
          <div className="grid items-start gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
            <aside className="grid gap-2 lg:sticky lg:top-6">
              <div className="px-2">
                <h2 className="text-sm font-medium">Requests</h2>
                <p className="text-xs text-muted-foreground">Each simulated user keeps sending these, picked by traffic share.</p>
              </div>
              <ul className="grid gap-1" aria-label="Requests">
                {flows.map((f, i) => {
                  const s = f.steps[0]
                  const pct = share(f)
                  return (
                    <li key={f.id}>
                      <div
                        className={cn(
                          'group grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-md border border-transparent px-2 py-1.5',
                          i === sel ? 'border-border bg-muted' : 'hover:bg-muted/50',
                        )}
                      >
                        <Switch
                          size="sm"
                          title={f.enabled ? 'Sent during runs. Click to skip it.' : 'Skipped during runs. Click to send it again.'}
                          aria-label={`Send ${f.name} during runs`}
                          checked={f.enabled}
                          disabled={readOnly}
                          onCheckedChange={(on) => setFlows(flows.map((x, j) => (j === i ? { ...x, enabled: on, steps: [{ ...x.steps[0], enabled: on }] } : x)))}
                        />
                        <button type="button" onClick={() => setSelected(i)} className="min-w-0 text-left" aria-current={i === sel ? 'true' : undefined}>
                          <span className={cn('flex items-center gap-1.5 text-sm', !f.enabled && 'text-muted-foreground line-through', hasErrorUnder(shownErrors, `flows.${i}`) && 'text-destructive')}>
                            <span className="w-12 shrink-0 font-mono text-xs text-muted-foreground">{s.method}</span>
                            <span className="truncate font-medium">{f.name}</span>
                          </span>
                          <span className="block truncate pl-[3.375rem] font-mono text-xs text-muted-foreground">{s.url}</span>
                        </button>
                        <span className="text-xs text-muted-foreground tabular-nums">{pct === null ? '' : `${pct.toFixed(0)}%`}</span>
                      </div>
                    </li>
                  )
                })}
              </ul>
              {!readOnly && (
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={add} disabled={flows.length >= 100}>
                    <PlusIcon />
                    Add request
                  </Button>
                  <Button variant="ghost" size="icon-sm" aria-label="Duplicate selected request" onClick={() => {
                    setFlows([...flows.slice(0, sel + 1), cloneFlow(flows[sel]), ...flows.slice(sel + 1)])
                    setSelected(sel + 1)
                  }}>
                    <CopyIcon />
                  </Button>
                  <Button variant="ghost" size="icon-sm" aria-label="Delete selected request" onClick={() => setDeleting(sel)}>
                    <Trash2Icon />
                  </Button>
                </div>
              )}
            </aside>
            <fieldset disabled={readOnly} className="min-w-0 rounded-lg border p-4 md:p-6">
              <legend className="sr-only">Request {flows[sel].name}</legend>
              <EndpointEditor
                key={flows[sel].id}
                flow={flows[sel]}
                index={sel}
                share={share(flows[sel])}
                onChange={(f) => setFlows(flows.map((x, j) => (j === sel ? f : x)))}
                onTryErrors={(e) => setErrors(new Map(e.details.map((d) => [d.path.replace(/^step/, `flows.${sel}.steps.0`), d.message])))}
              />
            </fieldset>
          </div>
        )}
          </TabsContent>
        </Tabs>
      </div>

      <ConfirmDelete
        target={deleting}
        title={`Delete ${deleting !== null ? flows[deleting]?.name : ''}?`}
        description="The request is removed from this test when you save."
        confirm="Delete request"
        onConfirm={() => {
          if (deleting === null) return
          setFlows(flows.filter((_, j) => j !== deleting))
          setSelected(Math.max(0, deleting - 1))
          setDeleting(null)
        }}
        onCancel={() => setDeleting(null)}
      />
      <ConfirmDelete
        target={blocker.state === 'blocked' ? blocker : null}
        title="Leave without saving?"
        description="Your changes to this test will be lost."
        confirm="Discard changes"
        onConfirm={() => blocker.proceed?.()}
        onCancel={() => blocker.reset?.()}
      />
    </BuilderContext.Provider>
  )
}
