import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FolderIcon, PlusIcon } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { useMe } from '@/api/auth'
import { api, ApiError, errorMessage } from '@/api/client'
import { keys } from '@/api/keys'
import type { Project } from '@/api/types'
import { FormField } from '@/components/form-field'
import { EmptyState, PageHeader } from '@/components/page'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatDate } from '@/lib/format'

export function ProjectsPage() {
  const { data: me } = useMe()
  const projects = useQuery({ queryKey: keys.projects, queryFn: () => api<Project[]>('GET', '/projects') })
  const [creating, setCreating] = useState(false)
  const canEdit = !!me?.can.edit

  const newButton = canEdit && (
    <Button onClick={() => setCreating(true)}>
      <PlusIcon />
      New project
    </Button>
  )

  return (
    <div className="max-w-5xl">
      <PageHeader title="Projects and targets" back={<Link to="/tests" className="hover:text-foreground">Tests</Link>} description="Folders for your tests and the servers (targets) they call." actions={projects.data?.length ? newButton : null} />
      {projects.isPending ? (
        <Skeleton className="h-40 w-full" />
      ) : projects.isError ? (
        <p className="text-sm text-destructive">{errorMessage(projects.error)}</p>
      ) : projects.data.length === 0 ? (
        <EmptyState icon={<FolderIcon />} title="No projects yet" action={newButton}>
          {canEdit ? 'Create a project to keep related tests and targets together.' : 'An editor has not created any projects yet.'}
        </EmptyState>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="w-24 text-right">Tests</TableHead>
                <TableHead className="hidden w-48 md:table-cell">Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {projects.data.map((p) => (
                <TableRow key={p.id} className="relative">
                  <TableCell>
                    <Link to={`/projects/${p.id}`} className="font-medium after:absolute after:inset-0 hover:underline">
                      {p.name}
                    </Link>
                    {p.description && <p className="truncate text-sm text-muted-foreground">{p.description}</p>}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{p.testCount}</TableCell>
                  <TableCell className="hidden text-sm text-muted-foreground md:table-cell">{formatDate(p.createdAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <ProjectDialog open={creating} onOpenChange={setCreating} />
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
            <DialogDescription>Usually one per service or API you test.</DialogDescription>
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
