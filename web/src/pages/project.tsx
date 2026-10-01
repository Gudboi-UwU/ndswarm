import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { ChevronRightIcon, CopyIcon, DownloadIcon, EllipsisIcon, FileUpIcon, FlaskConicalIcon, FolderIcon, PencilIcon, PlusIcon, ServerIcon, Trash2Icon } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { useMe } from '@/api/auth'
import { api, ApiError, errorMessage } from '@/api/client'
import { keys } from '@/api/keys'
import type { Environment, Project, Test, TestSummary } from '@/api/types'
import { EnvironmentDialog } from '@/components/environment-dialog'
import { ImportDialog } from '@/components/import-dialog'
import { RunsView } from '@/components/run-table'
import { NewTestDialog } from '@/components/new-test-dialog'
import { ConfirmDelete, EmptyState, ErrorState, PageHeader, useTitle } from '@/components/page'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { formatDate } from '@/lib/format'
import { NotFoundPage } from './not-found'
import { ProjectDialog } from './projects'

// A test's folder is a " / "-joined path, e.g. "Orders / Admin". This builds the tree the Tests
// tab renders: tests with no folder stay flat, the rest are grouped by each path segment.
interface FolderNode {
  name: string
  path: string
  tests: TestSummary[]
  children: FolderNode[]
}

function buildFolderTree(tests: TestSummary[]): { rootTests: TestSummary[]; tops: FolderNode[] } {
  const rootTests: TestSummary[] = []
  const nodes = new Map<string, FolderNode>()
  const tops: FolderNode[] = []
  const ensure = (path: string, segs: string[]): FolderNode => {
    const existing = nodes.get(path)
    if (existing) return existing
    const node: FolderNode = { name: segs[segs.length - 1], path, tests: [], children: [] }
    nodes.set(path, node)
    if (segs.length === 1) {
      tops.push(node)
    } else {
      ensure(segs.slice(0, -1).join(' / '), segs.slice(0, -1)).children.push(node)
    }
    return node
  }
  for (const t of tests) {
    if (!t.folder) {
      rootTests.push(t)
      continue
    }
    ensure(t.folder, t.folder.split(' / ')).tests.push(t)
  }
  const sort = (list: FolderNode[]) => {
    list.sort((a, b) => a.name.localeCompare(b.name))
    list.forEach((n) => sort(n.children))
  }
  sort(tops)
  return { rootTests, tops }
}

function countTests(node: FolderNode): number {
  return node.tests.length + node.children.reduce((n, c) => n + countTests(c), 0)
}

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
  // null = closed; otherwise the dialog is open, prefilled to this folder ("" = no folder).
  const [creating, setCreating] = useState<string | null>(null)
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

  useTitle(project.data?.name, 'Project')
  if (project.error instanceof ApiError && project.error.status === 404) return <NotFoundPage />
  if (project.isPending) return <Skeleton className="h-48 max-w-5xl" />
  if (project.isError) return <ErrorState error={project.error} onRetry={() => void project.refetch()} />
  const p = project.data

  return (
    <div className="max-w-6xl">
      <PageHeader
        back={
          <>
            <Link to="/projects" className="hover:text-foreground">Projects</Link>
            {' / '}
            {p.name}
          </>
        }
        title={p.name}
        description={p.description || undefined}
        actions={
          <>
            {canEdit && (
              <Button onClick={() => setCreating('')}>
                <PlusIcon />
                New test
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" aria-label="More actions">
                  <EllipsisIcon />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {canEdit && (
                  <DropdownMenuItem onSelect={() => setImporting(true)}>
                    <FileUpIcon />
                    Import
                  </DropdownMenuItem>
                )}
                {canEdit && (
                  <DropdownMenuItem onSelect={() => setEditing(true)}>
                    <PencilIcon />
                    Rename
                  </DropdownMenuItem>
                )}
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <DownloadIcon />
                    Export
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    <DropdownMenuItem asChild>
                      <a href={`/api/v1/projects/${id}/export?format=ndswarm&type=json`} download>ndswarm file (.json)</a>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <a href={`/api/v1/projects/${id}/export?format=ndswarm&type=yaml`} download>ndswarm file (.yaml)</a>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <a href={`/api/v1/projects/${id}/export?format=postman`} download>Postman collection</a>
                    </DropdownMenuItem>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                {canEdit && (
                  <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(true)}>
                    <Trash2Icon />
                    Delete project
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
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
          <TestsTab projectId={id} canEdit={canEdit} onNew={(folder) => setCreating(folder ?? '')} />
        </TabsContent>
        <TabsContent value="runs" className="mt-6">
          <RunsView projectId={id} />
        </TabsContent>
        <TabsContent value="servers" className="mt-6">
          <EnvironmentsTab projectId={id} envs={envs} canEdit={canEdit} />
        </TabsContent>
      </Tabs>

      <ProjectDialog key={`${p.id}-${editing}`} open={editing} onOpenChange={setEditing} project={p} />
      {creating !== null && (
        <NewTestDialog open={creating !== null} onOpenChange={(o) => setCreating(o ? creating : null)} projectId={id} folder={creating} />
      )}
      {importing && <ImportDialog open={importing} onOpenChange={setImporting} projectId={id} />}
      <ConfirmDelete
        target={deleting ? p : null}
        title={`Delete ${p.name}?`}
        description={`Its ${p.testCount} test(s), their runs and all servers are deleted too. This cannot be undone.`}
        confirm="Delete project"
        pendingLabel="Deleting"
        pending={remove.isPending}
        error={remove.error}
        onConfirm={() => remove.mutate()}
        onCancel={() => setDeleting(false)}
      />
    </div>
  )
}

function TestsTab({ projectId, canEdit, onNew }: { projectId: number; canEdit: boolean; onNew: (folder?: string) => void }) {
  const tests = useQuery({ queryKey: keys.tests(projectId), queryFn: () => api<TestSummary[]>('GET', `/projects/${projectId}/tests`) })
  const [deleting, setDeleting] = useState<TestSummary | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null) // folder path being renamed, or null
  const [moving, setMoving] = useState<TestSummary | null>(null)
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
  const rename = useMutation({
    mutationFn: ({ from, to }: { from: string; to: string }) => api<void>('POST', `/projects/${projectId}/folders/rename`, { from, to }),
    onSuccess: async () => {
      toast.success('Folder renamed')
      setRenaming(null)
      await refresh()
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const move = useMutation({
    mutationFn: ({ test, folder }: { test: TestSummary; folder: string }) => api<Test>('POST', `/tests/${test.id}/folder`, { folder }),
    onSuccess: async (_, { test }) => {
      toast.success(`Moved ${test.name}`)
      setMoving(null)
      await refresh()
    },
    onError: (e) => toast.error(errorMessage(e)),
  })

  if (tests.isPending) return <Skeleton className="h-32 w-full" />
  if (tests.isError) return <ErrorState error={tests.error} onRetry={() => void tests.refetch()} />
  if (tests.data.length === 0) {
    return (
      <EmptyState
        icon={<FlaskConicalIcon />}
        title="No tests in this project yet"
        action={
          // The page header already has the primary "New test" button; this one stays secondary
          // so there is exactly one obvious next step on screen.
          canEdit && (
            <Button variant="outline" onClick={() => onNew()}>
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

  const { rootTests, tops } = buildFolderTree(tests.data)
  const folderOptions = [...new Set(tests.data.map((t) => t.folder).filter(Boolean))].sort()

  const renderRow = (t: TestSummary): ReactNode => (
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
            <DropdownMenuItem onSelect={() => setMoving(t)}>
              <FolderIcon />
              Move to folder...
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(t)}>
              <Trash2Icon />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </li>
  )

  return (
    <>
      <div className="grid gap-3">
        {rootTests.length > 0 && <ul className="divide-y rounded-lg border">{rootTests.map(renderRow)}</ul>}
        {tops.map((node) => (
          <FolderSection key={node.path} node={node} depth={0} canEdit={canEdit} renderRow={renderRow} onRename={setRenaming} onNewTest={onNew} />
        ))}
      </div>
      <ConfirmDelete
        target={deleting}
        title={`Delete ${deleting?.name}?`}
        description="The test and its requests are removed. Its past runs stay in the run history. This cannot be undone."
        confirm="Delete test"
        pendingLabel="Deleting"
        pending={remove.isPending}
        error={remove.error}
        onConfirm={() => deleting && remove.mutate(deleting)}
        onCancel={() => setDeleting(null)}
      />
      <RenameFolderDialog
        key={renaming ?? 'closed'}
        folder={renaming}
        onOpenChange={(o) => !o && setRenaming(null)}
        onConfirm={(to) => renaming !== null && rename.mutate({ from: renaming, to })}
        pending={rename.isPending}
        error={rename.error}
      />
      <MoveTestDialog
        key={moving?.id ?? 'closed'}
        test={moving}
        options={folderOptions}
        onOpenChange={(o) => !o && setMoving(null)}
        onConfirm={(folder) => moving && move.mutate({ test: moving, folder })}
        pending={move.isPending}
        error={move.error}
      />
    </>
  )
}

// A folder section is a collapsible, open-by-default group: a test tree is meant to be browsed,
// not hidden behind a click the way optional extra content is.
function FolderSection({
  node,
  depth,
  canEdit,
  renderRow,
  onRename,
  onNewTest,
}: {
  node: FolderNode
  depth: number
  canEdit: boolean
  renderRow: (t: TestSummary) => ReactNode
  onRename: (path: string) => void
  onNewTest: (folder: string) => void
}) {
  const count = countTests(node)
  return (
    <details open className="group rounded-lg border" style={depth > 0 ? { marginLeft: `${depth * 1.25}rem` } : undefined}>
      <summary className="flex min-w-0 cursor-pointer list-none items-center gap-2 px-4 py-2.5 select-none hover:bg-muted/40 [&::-webkit-details-marker]:hidden">
        <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
        <FolderIcon className="size-4 shrink-0 text-muted-foreground" />
        <h3 className="truncate text-sm font-medium">{node.name}</h3>
        <span className="text-xs text-muted-foreground">
          {count} test{count === 1 ? '' : 's'}
        </span>
        {canEdit && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                className="relative z-10 ml-auto"
                aria-label={`Actions for folder ${node.name}`}
                // A click inside <summary> would otherwise also toggle the <details>.
                onClick={(e) => e.preventDefault()}
              >
                <EllipsisIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => onNewTest(node.path)}>
                <PlusIcon />
                New test in this folder
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onRename(node.path)}>
                <PencilIcon />
                Rename folder
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </summary>
      <div className="grid gap-3 border-t p-3">
        {node.tests.length > 0 && <ul className="divide-y rounded-md border">{node.tests.map(renderRow)}</ul>}
        {node.children.map((c) => (
          <FolderSection key={c.path} node={c} depth={depth + 1} canEdit={canEdit} renderRow={renderRow} onRename={onRename} onNewTest={onNewTest} />
        ))}
      </div>
    </details>
  )
}

function RenameFolderDialog({
  folder,
  onOpenChange,
  onConfirm,
  pending,
  error,
}: {
  folder: string | null
  onOpenChange: (o: boolean) => void
  onConfirm: (to: string) => void
  pending: boolean
  error: unknown
}) {
  const [to, setTo] = useState(folder ?? '')
  return (
    <Dialog open={folder !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            onConfirm(to.trim())
          }}
          className="grid gap-5"
          noValidate
        >
          <DialogHeader>
            <DialogTitle>Rename folder</DialogTitle>
            <DialogDescription>Every test in "{folder}", including its subfolders, moves to the new folder.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="rf-to">New folder</Label>
            <Input id="rf-to" value={to} onChange={(e) => setTo(e.target.value)} autoFocus />
          </div>
          {error != null && <p className="text-sm text-destructive">{errorMessage(error)}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !to.trim()}>
              {pending ? 'Renaming' : 'Rename'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function MoveTestDialog({
  test,
  options,
  onOpenChange,
  onConfirm,
  pending,
  error,
}: {
  test: TestSummary | null
  options: string[]
  onOpenChange: (o: boolean) => void
  onConfirm: (folder: string) => void
  pending: boolean
  error: unknown
}) {
  const [folder, setFolder] = useState(test?.folder ?? '')
  return (
    <Dialog open={test !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            onConfirm(folder.trim())
          }}
          className="grid gap-5"
          noValidate
        >
          <DialogHeader>
            <DialogTitle>Move {test?.name}</DialogTitle>
            <DialogDescription>Leave this empty to take it out of its folder.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="mv-folder">Folder</Label>
            <Input id="mv-folder" list="mv-folders" placeholder="e.g. Orders" value={folder} onChange={(e) => setFolder(e.target.value)} autoFocus />
            <datalist id="mv-folders">
              {options.map((f) => (
                <option key={f} value={f} />
              ))}
            </datalist>
          </div>
          {error != null && <p className="text-sm text-destructive">{errorMessage(error)}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Moving' : 'Move'}
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
      await queryClient.invalidateQueries({ queryKey: keys.projects })
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  // Outline, not the default variant: the page's one primary button is "New test" in the header.
  const newButton = canEdit && (
    <Button variant="outline" onClick={() => setEditing('new')}>
      <PlusIcon />
      New server
    </Button>
  )

  if (envs.isPending) return <Skeleton className="h-32 w-full" />
  if (envs.isError) return <ErrorState error={envs.error} onRetry={() => void envs.refetch()} />
  return (
    <>
      {envs.data.length === 0 ? (
        <EmptyState icon={<ServerIcon />} title="No servers yet" action={newButton}>
          A server is where requests go, such as local, staging or production: its address, shared variables and login. Tests pick one.
        </EmptyState>
      ) : (
        <>
          <div className="mb-3 flex justify-end">{newButton}</div>
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Server address</TableHead>
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
        pendingLabel="Deleting"
        pending={remove.isPending}
        error={remove.error}
        onConfirm={() => deleting && remove.mutate(deleting)}
        onCancel={() => setDeleting(null)}
      />
    </>
  )
}
