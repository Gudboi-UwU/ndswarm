import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FileUpIcon, FolderIcon, FolderPlusIcon, PlusIcon } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { useMe } from '@/api/auth'
import { api, ApiError, errorMessage } from '@/api/client'
import { keys } from '@/api/keys'
import type { Project } from '@/api/types'
import { FormField } from '@/components/form-field'
import { ImportDialog } from '@/components/import-dialog'
import { NewTestDialog } from '@/components/new-test-dialog'
import { EmptyState, ErrorState, PageHeader, useTitle } from '@/components/page'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDate } from '@/lib/format'

/** Top of the hierarchy: projects, then their tests, then each test's runs. */
export function ProjectsPage() {
  const { data: me } = useMe()
  const projects = useQuery({ queryKey: keys.projects, queryFn: () => api<Project[]>('GET', '/projects') })
  const [creating, setCreating] = useState(false)
  const [newTest, setNewTest] = useState(false)
  const [importing, setImporting] = useState(false)
  const canEdit = !!me?.can.edit
  useTitle('Projects')
  const actions = canEdit && (
    <>
      <Button variant="ghost" onClick={() => setImporting(true)}>
        <FileUpIcon />
        Import
      </Button>
      <Button variant="outline" onClick={() => setCreating(true)}>
        <FolderPlusIcon />
        New project
      </Button>
      <Button onClick={() => setNewTest(true)}>
        <PlusIcon />
        New test
      </Button>
    </>
  )

  return (
    <div className="max-w-5xl">
      <PageHeader title="Projects" description="A project groups the tests of one system and the servers they run against." actions={projects.data?.length ? actions : null} />
      {projects.isPending ? (
        <Skeleton className="h-40 w-full" />
      ) : projects.isError ? (
        <ErrorState error={projects.error} onRetry={() => void projects.refetch()} />
      ) : projects.data.length === 0 ? (
        <EmptyState icon={<FolderIcon />} title="No projects yet" action={canEdit && <div className="flex flex-wrap gap-2">{actions}</div>}>
          {canEdit
            ? 'Start with New test: it asks for the server address and creates a project for you. Or create an empty project first, or import tests from a file or a Postman collection.'
            : 'An editor has not created any projects yet.'}
        </EmptyState>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {projects.data.map((p) => (
            <li key={p.id} className="relative grid content-start gap-2 rounded-lg border p-4 transition-colors hover:bg-muted/40">
              <Link to={`/projects/${p.id}`} className="font-medium after:absolute after:inset-0 hover:underline">
                {p.name}
              </Link>
              {p.description && <p className="line-clamp-2 text-sm text-muted-foreground">{p.description}</p>}
              <p className="text-sm">
                {p.testCount} test{p.testCount === 1 ? '' : 's'}
                <span className="text-muted-foreground"> and </span>
                {p.targetCount} server{p.targetCount === 1 ? '' : 's'}
              </p>
              <p className="text-xs text-muted-foreground">{p.lastRunAt ? `Last run ${formatDate(p.lastRunAt)}` : 'No runs yet'}</p>
            </li>
          ))}
        </ul>
      )}
      <ProjectDialog open={creating} onOpenChange={setCreating} />
      {newTest && <NewTestDialog open={newTest} onOpenChange={setNewTest} />}
      {importing && <ImportDialog open={importing} onOpenChange={setImporting} />}
    </div>
  )
}

/** Create a project, or edit one when `project` is given. */
export function ProjectDialog({ open, onOpenChange, project }: { open: boolean; onOpenChange: (o: boolean) => void; project?: Project }) {
  const [name, setName] = useState(project?.name ?? '')
  const [description, setDescription] = useState(project?.description ?? '')
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const save = useMutation({
    mutationFn: () =>
      project
        ? api<Project>('PATCH', `/projects/${project.id}`, { name, description })
        : api<Project>('POST', '/projects', { name, description }),
    onSuccess: async (p) => {
      await queryClient.invalidateQueries({ queryKey: keys.projects })
      await queryClient.invalidateQueries({ queryKey: keys.project(p.id) })
      toast.success(project ? 'Project saved' : `Created ${p.name}`)
      onOpenChange(false)
      if (!project) await navigate(`/projects/${p.id}`)
    },
  })
  const err = save.error instanceof ApiError ? save.error : null

  const submit = (e: FormEvent) => {
    e.preventDefault()
    save.mutate()
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o)
        if (!o) save.reset()
      }}
    >
      <DialogContent>
        <form onSubmit={submit} className="grid gap-5" noValidate>
          <DialogHeader>
            <DialogTitle>{project ? 'Edit project' : 'New project'}</DialogTitle>
            <DialogDescription>Usually one per system you test, for example "Shop API".</DialogDescription>
          </DialogHeader>
          {save.error && !err?.details.length && <p className="text-sm text-destructive">{errorMessage(save.error)}</p>}
          <FormField id="project-name" label="Name" value={name} onChange={(e) => setName(e.target.value)} error={err?.field('name')} autoFocus />
          <FormField
            id="project-description"
            label="Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            error={err?.field('description')}
            hint="Optional."
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending || !name.trim()}>
              {project ? 'Save' : 'Create project'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
