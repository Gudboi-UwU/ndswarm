import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { CopyIcon, EllipsisIcon, FileUpIcon, FlaskConicalIcon, PencilIcon, PlusIcon, ServerIcon, Trash2Icon } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { useMe } from '@/api/auth'
import { api, ApiError, errorMessage } from '@/api/client'
import { keys } from '@/api/keys'
import type { Environment, Project, Test, TestSummary } from '@/api/types'
import { EnvironmentDialog } from '@/components/environment-dialog'
import { ExportMenu } from '@/components/export-menu'
import { ImportDialog } from '@/components/import-dialog'
import { RunsView } from '@/components/run-table'
import { NewTestDialog } from '@/components/new-test-dialog'
import { ConfirmDelete, EmptyState, PageHeader } from '@/components/page'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
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
  const tab = ['runs', 'servers'].includes(params.get('tab') ?? '') ? params.get('tab')! : 'tests'
  const project = useQuery({ queryKey: keys.project(id), queryFn: () => api<Project>('GET', `/projects/${id}`) })
  const envs = useQuery({ queryKey: keys.environments(id), queryFn: () => api<Environment[]>('GET', `/projects/${id}/environments`) })
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [creating, setCreating] = useState(false)
  const [importing, setImporting] = useState(false)
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
    <div className="max-w-6xl">
      <PageHeader
        back={<Link to="/projects" className="hover:text-foreground">Projects</Link>}
        title={p.name}
        description={p.description || undefined}
        actions={
          <>
            <ExportMenu path={`/projects/${id}`} />
            {canEdit && (
              <>
                <Button variant="ghost" onClick={() => setImporting(true)}>
                  <FileUpIcon />
                  Import
                </Button>
                <Button variant="ghost" onClick={() => setEditing(true)}>
                  <PencilIcon />
                  Rename
                </Button>
                <Button variant="ghost" aria-label="Delete project" onClick={() => setDeleting(true)}>
                  <Trash2Icon />
                </Button>
                <Button onClick={() => setCreating(true)}>
                  <PlusIcon />
                  New test
                </Button>
              </>
            )}
          </>
        }
      />
      <Tabs value={tab} onValueChange={(t) => setParams(t === 'tests' ? {} : { tab: t }, { replace: true })}>
        <TabsList>
          <TabsTrigger value="tests">Tests ({p.testCount})</TabsTrigger>
          <TabsTrigger value="runs">Runs</TabsTrigger>
          <TabsTrigger value="servers">Servers ({envs.data?.length ?? p.targetCount})</TabsTrigger>
        </TabsList>
        <TabsContent value="tests" className="mt-6">
          <TestsTab projectId={id} canEdit={canEdit} onNew={() => setCreating(true)} />
        </TabsContent>
        <TabsContent value="runs" className="mt-6">
          <RunsView projectId={id} />
        </TabsContent>
        <TabsContent value="servers" className="mt-6">
          <EnvironmentsTab projectId={id} envs={envs} canEdit={canEdit} />
        </TabsContent>
      </Tabs>

      <ProjectDialog key={`${p.id}-${editing}`} open={editing} onOpenChange={setEditing} project={p} />
      {creating && <NewTestDialog open={creating} onOpenChange={setCreating} projectId={id} />}
      {importing && <ImportDialog open={importing} onOpenChange={setImporting} projectId={id} />}
      <ConfirmDelete
        target={deleting ? p : null}
        title={`Delete ${p.name}?`}
        description={`Its ${p.testCount} test(s), their runs and all servers are deleted too. This cannot be undone.`}
        confirm="Delete project"
        pending={remove.isPending}
        onConfirm={() => remove.mutate()}
        onCancel={() => setDeleting(false)}
      />
    </div>
  )
}

function TestsTab({ projectId, canEdit, onNew }: { projectId: number; canEdit: boolean; onNew: () => void }) {
  const tests = useQuery({ queryKey: keys.tests(projectId), queryFn: () => api<TestSummary[]>('GET', `/projects/${projectId}/tests`) })
  const [deleting, setDeleting] = useState<TestSummary | null>(null)
  const queryClient = useQueryClient()
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

  if (tests.isPending) return <Skeleton className="h-32 w-full" />
  if (tests.isError) return <p className="text-sm text-destructive">{errorMessage(tests.error)}</p>
  if (tests.data.length === 0) {
    return (
      <EmptyState
        icon={<FlaskConicalIcon />}
        title="No tests in this project yet"
        action={
          canEdit && (
            <Button onClick={onNew}>
              <PlusIcon />
              New test
            </Button>
          )
        }
      >
        A test is a list of requests to send, and how many users send them for how long.
      </EmptyState>
    )
  }
  return (
    <>
      <ul className="divide-y rounded-lg border">
        {tests.data.map((t) => (
          <li key={t.id} className="relative grid gap-1 px-4 py-3 hover:bg-muted/40 sm:grid-cols-[minmax(0,1fr)_14rem_13rem_2.5rem] sm:items-center sm:gap-4">
            <div className="min-w-0">
              <Link to={`/tests/${t.id}`} className="font-medium after:absolute after:inset-0 hover:underline">
                {t.name}
              </Link>
              <p className="text-sm text-muted-foreground">
                {t.endpoints} request{t.endpoints === 1 ? '' : 's'}
              </p>
            </div>
            <p className="truncate font-mono text-xs text-muted-foreground" title={t.targetUrl}>
              {t.targetUrl || 'no server set'}
            </p>
            <p className="text-xs text-muted-foreground sm:text-right">{t.lastRunAt ? `Last run ${formatDate(t.lastRunAt)}` : 'Never run'}</p>
            {canEdit && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-sm" className="relative z-10" aria-label={`Actions for ${t.name}`}>
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
            )}
          </li>
        ))}
      </ul>
      <ConfirmDelete
        target={deleting}
        title={`Delete ${deleting?.name}?`}
        description="The test and its requests are removed. Its past runs stay in the run history. This cannot be undone."
        confirm="Delete test"
        pending={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting)}
        onCancel={() => setDeleting(null)}
      />
    </>
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
      New server
    </Button>
  )

  if (envs.isPending) return <Skeleton className="h-32 w-full" />
  if (envs.isError) return <p className="text-sm text-destructive">{errorMessage(envs.error)}</p>
  return (
    <>
      {envs.data.length === 0 ? (
        <EmptyState icon={<ServerIcon />} title="No servers yet" action={newButton}>
          A server is where requests go, such as local, staging or production: its address, shared variables and login. Tests pick one.
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
        description="Tests that use it keep working with full URLs only, until you pick another server."
        confirm="Delete server"
        pending={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting)}
        onCancel={() => setDeleting(null)}
      />
    </>
  )
}
