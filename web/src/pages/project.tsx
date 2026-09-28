import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { CopyIcon, EllipsisIcon, FlaskConicalIcon, PencilIcon, PlusIcon, ServerIcon, Trash2Icon } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { useMe } from '@/api/auth'
import { api, ApiError, errorMessage } from '@/api/client'
import { keys } from '@/api/keys'
import type { Environment, Project, Test, TestSummary } from '@/api/types'
import { EnvironmentDialog } from '@/components/environment-dialog'
import { FormField } from '@/components/form-field'
import { ConfirmDelete, EmptyState, PageHeader } from '@/components/page'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { formatDate } from '@/lib/format'
import { NotFoundPage } from './not-found'
import { ProjectDialog } from './projects'

export function ProjectPage() {
  const id = Number(useParams().id)
  const { data: me } = useMe()
  const canEdit = !!me?.can.edit
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') === 'environments' ? 'environments' : 'tests'
  const project = useQuery({ queryKey: keys.project(id), queryFn: () => api<Project>('GET', `/projects/${id}`) })
  const envs = useQuery({ queryKey: keys.environments(id), queryFn: () => api<Environment[]>('GET', `/projects/${id}/environments`) })
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const remove = useMutation({
    mutationFn: () => api<void>('DELETE', `/projects/${id}`),
    onSuccess: async () => {
      toast.success(`Deleted ${project.data?.name}`)
      await queryClient.invalidateQueries({ queryKey: keys.projects })
      await navigate('/projects')
    },
    onError: (e) => toast.error(errorMessage(e)),
  })

  if (project.error instanceof ApiError && project.error.status === 404) return <NotFoundPage />
  if (project.isPending) return <Skeleton className="h-48 max-w-5xl" />
  if (project.isError) return <p className="text-sm text-destructive">{errorMessage(project.error)}</p>
  const p = project.data

  return (
    <div className="max-w-5xl">
      <PageHeader
        back={<Link to="/projects" className="hover:text-foreground">Projects</Link>}
        title={p.name}
        description={p.description || undefined}
        actions={
          canEdit && (
            <>
              <Button variant="outline" onClick={() => setEditing(true)}>
                <PencilIcon />
                Edit
              </Button>
              <Button variant="outline" aria-label="Delete project" onClick={() => setDeleting(true)}>
                <Trash2Icon />
              </Button>
            </>
          )
        }
      />
      <Tabs value={tab} onValueChange={(t) => setParams(t === 'tests' ? {} : { tab: t }, { replace: true })}>
        <TabsList>
          <TabsTrigger value="tests">Tests</TabsTrigger>
          <TabsTrigger value="environments">Environments</TabsTrigger>
        </TabsList>
        <TabsContent value="tests" className="mt-6">
          <TestsTab projectId={id} envs={envs.data ?? []} canEdit={canEdit} />
        </TabsContent>
        <TabsContent value="environments" className="mt-6">
          <EnvironmentsTab projectId={id} envs={envs} canEdit={canEdit} />
        </TabsContent>
      </Tabs>

      <ProjectDialog key={`${p.id}-${editing}`} open={editing} onOpenChange={setEditing} project={p} />
      <ConfirmDelete
        target={deleting ? p : null}
        title={`Delete ${p.name}?`}
        description={`Its ${p.testCount} test(s) and all environments are deleted too. This cannot be undone.`}
        confirm="Delete project"
        pending={remove.isPending}
        onConfirm={() => remove.mutate()}
        onCancel={() => setDeleting(false)}
      />
    </div>
  )
}

function TestsTab({ projectId, envs, canEdit }: { projectId: number; envs: Environment[]; canEdit: boolean }) {
  const tests = useQuery({ queryKey: keys.tests(projectId), queryFn: () => api<TestSummary[]>('GET', `/projects/${projectId}/tests`) })
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<TestSummary | null>(null)
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const refresh = () => Promise.all([queryClient.invalidateQueries({ queryKey: keys.tests(projectId) }), queryClient.invalidateQueries({ queryKey: keys.project(projectId) })])
  const duplicate = useMutation({
    mutationFn: (t: TestSummary) => api<Test>('POST', `/tests/${t.id}/duplicate`),
    onSuccess: async (t) => {
      toast.success(`Created ${t.name}`)
      await refresh()
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const remove = useMutation({
    mutationFn: (t: TestSummary) => api<void>('DELETE', `/tests/${t.id}`),
    onSuccess: async (_, t) => {
      toast.success(`Deleted ${t.name}`)
      setDeleting(null)
      await refresh()
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const envName = (id: number | null) => envs.find((e) => e.id === id)?.name ?? 'None'

  const newButton = canEdit && (
    <Button onClick={() => setCreating(true)}>
      <PlusIcon />
      New test
    </Button>
  )

  if (tests.isPending) return <Skeleton className="h-32 w-full" />
  if (tests.isError) return <p className="text-sm text-destructive">{errorMessage(tests.error)}</p>
  return (
    <>
      {tests.data.length === 0 ? (
        <EmptyState icon={<FlaskConicalIcon />} title="No tests yet" action={newButton}>
          A test lists the endpoints to call, with their bodies and how hard to push them.
        </EmptyState>
      ) : (
        <>
          <div className="mb-3 flex justify-end">{newButton}</div>
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead className="w-28 text-right">Endpoints</TableHead>
                  <TableHead className="hidden w-40 sm:table-cell">Environment</TableHead>
                  <TableHead className="hidden w-48 md:table-cell">Updated</TableHead>
                  {canEdit && <TableHead className="w-12"><span className="sr-only">Actions</span></TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {tests.data.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell>
                      <Link to={`/tests/${t.id}`} className="font-medium hover:underline">
                        {t.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{t.endpoints}</TableCell>
                    <TableCell className="hidden text-sm sm:table-cell">{envName(t.environmentId)}</TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground md:table-cell">{formatDate(t.updatedAt)}</TableCell>
                    {canEdit && (
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${t.name}`}>
                              <EllipsisIcon />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onSelect={() => duplicate.mutate(t)}>
                              <CopyIcon />
                              Duplicate
                            </DropdownMenuItem>
                            <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(t)}>
                              <Trash2Icon />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
      <NewTestDialog
        key={String(creating)}
        open={creating}
        onOpenChange={setCreating}
        projectId={projectId}
        envs={envs}
        onCreated={async (t) => {
          await refresh()
          await navigate(`/tests/${t.id}`)
        }}
      />
      <ConfirmDelete
        target={deleting}
        title={`Delete ${deleting?.name}?`}
        description="The test and its endpoints are removed. This cannot be undone."
        confirm="Delete test"
        pending={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting)}
        onCancel={() => setDeleting(null)}
      />
    </>
  )
}

function NewTestDialog({
  open,
  onOpenChange,
  projectId,
  envs,
  onCreated,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  projectId: number
  envs: Environment[]
  onCreated: (t: Test) => Promise<void>
}) {
  const [name, setName] = useState('')
  const [envId, setEnvId] = useState<string>(envs[0] ? String(envs[0].id) : 'none')
  const create = useMutation({
    mutationFn: () => api<Test>('POST', `/projects/${projectId}/tests`, { name, environmentId: envId === 'none' ? null : Number(envId), flows: [] }),
    onSuccess: async (t) => {
      onOpenChange(false)
      await onCreated(t)
    },
  })
  const err = create.error instanceof ApiError ? create.error : null
  const submit = (e: FormEvent) => {
    e.preventDefault()
    create.mutate()
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-5" noValidate>
          <DialogHeader>
            <DialogTitle>New test</DialogTitle>
            <DialogDescription>You add endpoints in the test builder next.</DialogDescription>
          </DialogHeader>
          {create.error && !err?.details.length && <p className="text-sm text-destructive">{errorMessage(create.error)}</p>}
          <FormField id="test-name" label="Name" placeholder="Checkout flow" value={name} onChange={(e) => setName(e.target.value)} error={err?.field('name')} autoFocus />
          <div className="grid gap-2">
            <Label htmlFor="test-env">Environment</Label>
            <Select value={envId} onValueChange={setEnvId}>
              <SelectTrigger id="test-env" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None (use full URLs)</SelectItem>
                {envs.map((e) => (
                  <SelectItem key={e.id} value={String(e.id)}>
                    {e.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending || !name.trim()}>
              Create test
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function EnvironmentsTab({ projectId, envs, canEdit }: { projectId: number; envs: UseQueryResult<Environment[]>; canEdit: boolean }) {
  const [editing, setEditing] = useState<Environment | 'new' | null>(null)
  const [deleting, setDeleting] = useState<Environment | null>(null)
  const queryClient = useQueryClient()
  const remove = useMutation({
    mutationFn: (e: Environment) => api<void>('DELETE', `/environments/${e.id}`),
    onSuccess: async (_, e) => {
      toast.success(`Deleted ${e.name}`)
      setDeleting(null)
      await queryClient.invalidateQueries({ queryKey: keys.environments(projectId) })
      await queryClient.invalidateQueries({ queryKey: keys.tests(projectId) })
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const newButton = canEdit && (
    <Button onClick={() => setEditing('new')}>
      <PlusIcon />
      New environment
    </Button>
  )

  if (envs.isPending) return <Skeleton className="h-32 w-full" />
  if (envs.isError) return <p className="text-sm text-destructive">{errorMessage(envs.error)}</p>
  return (
    <>
      {envs.data.length === 0 ? (
        <EmptyState icon={<ServerIcon />} title="No environments yet" action={newButton}>
          An environment holds the base URL, variables and auth for one target, such as local, staging or production.
        </EmptyState>
      ) : (
        <>
          <div className="mb-3 flex justify-end">{newButton}</div>
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Base URL</TableHead>
                  <TableHead className="hidden w-28 text-right sm:table-cell">Variables</TableHead>
                  {canEdit && <TableHead className="w-24"><span className="sr-only">Actions</span></TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {envs.data.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="font-medium">{e.name}</TableCell>
                    <TableCell className="max-w-64 truncate font-mono text-sm">{e.baseUrl || <span className="text-muted-foreground">Not set</span>}</TableCell>
                    <TableCell className="hidden text-right font-mono tabular-nums sm:table-cell">{e.variables.length}</TableCell>
                    {canEdit && (
                      <TableCell className="text-right">
                        <Button variant="ghost" size="icon-sm" aria-label={`Edit ${e.name}`} onClick={() => setEditing(e)}>
                          <PencilIcon />
                        </Button>
                        <Button variant="ghost" size="icon-sm" aria-label={`Delete ${e.name}`} onClick={() => setDeleting(e)}>
                          <Trash2Icon />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
      <EnvironmentDialog
        key={editing === 'new' ? 'new' : (editing?.id ?? 'closed')}
        projectId={projectId}
        env={editing && editing !== 'new' ? editing : undefined}
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
      />
      <ConfirmDelete
        target={deleting}
        title={`Delete ${deleting?.name}?`}
        description="Tests that use it keep working with full URLs only, until you pick another environment."
        confirm="Delete environment"
        pending={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting)}
        onCancel={() => setDeleting(null)}
      />
    </>
  )
}
