import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { api, ApiError, errorMessage } from '@/api/client'
import { keys } from '@/api/keys'
import type { Environment, Method, Project, Test, TestSummary } from '@/api/types'
import { FormField } from '@/components/form-field'
import { Help } from '@/components/table-help'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { glossary } from '@/lib/glossary'
import { newStep, uid } from '@/pages/test-builder/draft'

const NEW_URL = 'new'
const DEFAULT_PROJECT = 'My tests'

/**
 * The shortest way to a runnable test: a name, the server's address and one request.
 * Projects and targets are created behind the scenes when they do not exist yet.
 */
export function NewTestDialog({
  open,
  onOpenChange,
  projectId,
  folder: initialFolder,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  projectId?: number
  /** Prefills the Folder field, e.g. from a folder's "New test in this folder" menu item. */
  folder?: string
}) {
  const projects = useQuery({ queryKey: keys.projects, queryFn: () => api<Project[]>('GET', '/projects'), enabled: open })
  const [project, setProject] = useState<string>(projectId ? String(projectId) : '')
  const chosenProject = project || (projects.data?.[0] ? String(projects.data[0].id) : '')
  const targets = useQuery({
    queryKey: keys.environments(Number(chosenProject)),
    queryFn: () => api<Environment[]>('GET', `/projects/${chosenProject}/environments`),
    enabled: open && !!chosenProject,
  })
  const existingTests = useQuery({
    queryKey: keys.tests(Number(chosenProject)),
    queryFn: () => api<TestSummary[]>('GET', `/projects/${chosenProject}/tests`),
    enabled: open && !!chosenProject,
  })
  const folders = [...new Set((existingTests.data ?? []).map((t) => t.folder).filter(Boolean))].sort()
  const [name, setName] = useState('')
  const [folder, setFolder] = useState(initialFolder ?? '')
  const [target, setTarget] = useState('')
  const [url, setUrl] = useState('')
  const [method, setMethod] = useState<Method>('GET')
  const [path, setPath] = useState('/')
  const [urlError, setUrlError] = useState<string>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const withBaseUrl = targets.data?.filter((t) => t.baseUrl) ?? []
  const chosenTarget = target || (withBaseUrl[0] ? String(withBaseUrl[0].id) : NEW_URL)

  // Remembers what a previous, failed attempt already created, so retrying after an error
  // reuses that project/server instead of creating a duplicate each time.
  const created = useRef<{ projectId?: number; environmentId?: number }>({})

  const create = useMutation({
    mutationFn: async () => {
      let pid = created.current.projectId ?? Number(chosenProject)
      if (!pid) {
        pid = (await api<Project>('POST', '/projects', { name: DEFAULT_PROJECT, description: '' })).id
        created.current.projectId = pid
      }
      let envId: number
      if (chosenTarget === NEW_URL) {
        if (created.current.environmentId) {
          envId = created.current.environmentId
        } else {
          const base = url.trim().replace(/\/+$/, '')
          let host = base
          try {
            host = new URL(base).host
          } catch {
            setUrlError('Enter the full address, like https://api.example.com')
            throw new Error('invalid url')
          }
          envId = (await api<Environment>('POST', `/projects/${pid}/environments`, { name: host, baseUrl: base, variables: [], headers: [], auth: { type: 'none' } })).id
          created.current.environmentId = envId
        }
      } else {
        envId = Number(chosenTarget)
      }
      const step = { ...newStep(requestName(path)), method, url: path.trim() || '/' }
      if (method !== 'GET' && method !== 'HEAD' && method !== 'DELETE') step.body = { type: 'json', variantPick: 'roundRobin', contentType: '', variants: [{ id: uid(), name: 'default', weight: 1, enabled: true, mode: 'fields', fields: [], raw: '' }] }
      const test = await api<Test>('POST', `/projects/${pid}/tests`, {
        name,
        folder: folder.trim(),
        environmentId: envId,
        flows: [{ id: uid(), name: step.name, enabled: true, weight: 1, steps: [step] }],
      })
      return { test, pid }
    },
    onSuccess: async ({ test, pid }) => {
      await queryClient.invalidateQueries({ queryKey: keys.projects })
      await queryClient.invalidateQueries({ queryKey: keys.project(pid) })
      await queryClient.invalidateQueries({ queryKey: keys.tests(pid) })
      onOpenChange(false)
      await navigate(`/tests/${test.id}`)
    },
  })
  const err = create.error instanceof ApiError ? create.error : null

  const submit = (e: FormEvent) => {
    e.preventDefault()
    setUrlError(undefined)
    create.mutate()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} className="grid gap-5" noValidate>
          <DialogHeader>
            <DialogTitle>New load test</DialogTitle>
            <DialogDescription>Start with one request. You can add more requests and choose the load on the next screen.</DialogDescription>
          </DialogHeader>
          {create.error && !urlError && !err?.details.length && <p className="text-sm text-destructive">{errorMessage(create.error)}</p>}

          <FormField id="nt-name" label="Test name" placeholder="Checkout API" value={name} onChange={(e) => setName(e.target.value)} error={err?.field('name')} autoFocus />

          {(projects.data?.length ?? 0) > 1 && !projectId && (
            <div className="grid gap-2">
              <Label htmlFor="nt-project">Project</Label>
              <Select value={chosenProject} onValueChange={(v) => { setProject(v); setTarget('') }}>
                <SelectTrigger id="nt-project" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {projects.data?.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="grid gap-2">
            <Label htmlFor="nt-folder">
              Folder <Help help={glossary.folder}>(optional)</Help>
            </Label>
            <Input id="nt-folder" list="nt-folders" placeholder="e.g. Orders" value={folder} onChange={(e) => setFolder(e.target.value)} />
            <datalist id="nt-folders">
              {folders.map((f) => (
                <option key={f} value={f} />
              ))}
            </datalist>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="nt-target">Server to test</Label>
            {withBaseUrl.length > 0 && (
              <Select value={chosenTarget} onValueChange={setTarget}>
                <SelectTrigger id="nt-target" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {withBaseUrl.map((t) => (
                    <SelectItem key={t.id} value={String(t.id)}>
                      {t.baseUrl.includes(t.name) ? t.baseUrl : `${t.name} (${t.baseUrl})`}
                    </SelectItem>
                  ))}
                  <SelectItem value={NEW_URL}>Another server...</SelectItem>
                </SelectContent>
              </Select>
            )}
            {chosenTarget === NEW_URL && (
              <Input
                id={withBaseUrl.length ? undefined : 'nt-target'}
                aria-label="Server address"
                placeholder="https://api.example.com"
                className="font-mono text-[13px]"
                value={url}
                aria-invalid={urlError || err?.field('baseUrl') ? true : undefined}
                onChange={(e) => setUrl(e.target.value)}
              />
            )}
            <p className={urlError || err?.field('baseUrl') ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}>
              {urlError ??
                err?.field('baseUrl') ??
                (/\/\/(localhost|127\.0\.0\.1)\b/.test(url)
                  ? 'In Docker, localhost is the ndswarm container. For an API on this computer use http://host.docker.internal:<port>.'
                  : 'The address every request in this test starts with.')}
            </p>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="nt-path">First request</Label>
            <div className="grid grid-cols-[6.5rem_1fr] gap-2">
              <Select value={method} onValueChange={(m) => setMethod(m as Method)}>
                <SelectTrigger aria-label="Method" className="w-full font-mono">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const).map((m) => (
                    <SelectItem key={m} value={m} className="font-mono">
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input id="nt-path" className="font-mono text-[13px]" placeholder="/products" value={path} onChange={(e) => setPath(e.target.value)} />
            </div>
            <p className="text-sm text-muted-foreground">The path after the server address, for example /products.</p>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending || !name.trim() || (chosenTarget === NEW_URL && !url.trim())}>
              {create.isPending ? 'Creating' : 'Create test'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** "/api/products/{{int 1 9}}" -> "Products"; "/" -> "Home". */
function requestName(path: string): string {
  const seg = path.split('?')[0].split('/').filter((s) => s && !s.includes('{{')).pop()
  if (!seg) return 'Home'
  return seg.charAt(0).toUpperCase() + seg.slice(1).replace(/[-_]/g, ' ')
}
