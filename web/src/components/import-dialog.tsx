import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FileUpIcon, TriangleAlertIcon } from 'lucide-react'
import { useState, type DragEvent, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { api, ApiError, errorMessage } from '@/api/client'
import { keys } from '@/api/keys'
import type { ImportPreview, ImportResult, Project } from '@/api/types'
import { Disclosure } from '@/components/disclosure'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

const MAX_BYTES = 20 << 20
const formats: Record<ImportPreview['format'], string> = { ndswarm: 'ndswarm file', postman: 'Postman collection' }

/**
 * Bring in tests from a file: an ndswarm export or a Postman collection. The server shows what it
 * found first (nothing is saved), then creates the project, servers and tests in one go.
 */
export function ImportDialog({ open, onOpenChange, projectId }: { open: boolean; onOpenChange: (o: boolean) => void; projectId?: number }) {
  const [content, setContent] = useState('')
  const [fileName, setFileName] = useState('')
  const [environment, setEnvironment] = useState('')
  const [envName, setEnvName] = useState('')
  const [fileError, setFileError] = useState<string>()
  const [dragging, setDragging] = useState(false)
  const [target, setTarget] = useState<'new' | 'existing'>(projectId ? 'existing' : 'new')
  const [projectName, setProjectName] = useState('')
  const [existing, setExisting] = useState(projectId ? String(projectId) : '')
  const projects = useQuery({ queryKey: keys.projects, queryFn: () => api<Project[]>('GET', '/projects'), enabled: open })
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const preview = useMutation({
    mutationFn: () => api<ImportPreview>('POST', '/import/preview', { content, environment }),
    onSuccess: (p) => setProjectName(p.project.name),
  })
  const chosenExisting = existing || (projects.data?.[0] ? String(projects.data[0].id) : '')
  const save = useMutation({
    mutationFn: () =>
      api<ImportResult>('POST', '/import', target === 'new' ? { content, environment, newProject: projectName } : { content, environment, projectId: Number(chosenExisting) }),
    onSuccess: async (r) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: keys.projects }),
        queryClient.invalidateQueries({ queryKey: ['project'] }),
        queryClient.invalidateQueries({ queryKey: ['tests'] }),
      ])
      toast.success(`Imported ${r.tests.length} test${r.tests.length === 1 ? '' : 's'}`)
      onOpenChange(false)
      await navigate(`/projects/${r.projectId}`)
    },
  })

  const readFile = async (file: File | undefined, env: boolean) => {
    if (!file) return
    setFileError(undefined)
    preview.reset()
    if (file.size > MAX_BYTES) {
      setFileError(`${file.name} is larger than 20 MB.`)
      return
    }
    const text = await file.text()
    if (env) {
      setEnvironment(text)
      setEnvName(file.name)
    } else {
      setContent(text)
      setFileName(file.name)
    }
  }
  const drop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    void readFile(e.dataTransfer.files[0], false)
  }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (preview.data) save.mutate()
    else preview.mutate()
  }

  const p = preview.data
  const previewErr = preview.error instanceof ApiError ? (preview.error.field('content') ?? preview.error.message) : preview.error && errorMessage(preview.error)
  const saveErr = save.error instanceof ApiError ? (save.error.details.map((d) => d.message).join(' ') || save.error.message) : save.error && errorMessage(save.error)
  const hasProjects = (projects.data?.length ?? 0) > 0
  const requests = p?.tests.reduce((n, t) => n + t.requests.length, 0) ?? 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <form onSubmit={submit} className="grid min-w-0 gap-5" noValidate>
          <DialogHeader>
            <DialogTitle>Import tests</DialogTitle>
            <DialogDescription>
              {p ? 'Check what was found. Nothing is saved until you press Import.' : 'Bring in tests from an ndswarm export or a Postman collection, so you do not have to type requests again.'}
            </DialogDescription>
          </DialogHeader>

          {!p ? (
            <>
              <label
                onDragOver={(e) => {
                  e.preventDefault()
                  setDragging(true)
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={drop}
                className={cn(
                  'grid cursor-pointer justify-items-center gap-2 rounded-lg border border-dashed p-6 text-center transition-colors hover:bg-muted/40 has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50',
                  dragging && 'border-primary bg-primary/5',
                )}
              >
                <FileUpIcon className="size-5 text-primary" />
                <span className="font-medium">{fileName ? fileName : 'Drop a file here or choose a file'}</span>
                <span className="text-sm text-muted-foreground">
                  {fileName ? 'Choose another file to replace it.' : 'An ndswarm export (.json or .yaml) or a Postman collection (.json, version 2.0 or 2.1).'}
                </span>
                <input type="file" accept=".json,.yaml,.yml" className="sr-only" onChange={(e) => void readFile(e.target.files?.[0], false)} />
              </label>

              <Disclosure title="Paste instead" summary={!fileName && content ? `${content.length.toLocaleString()} characters` : undefined}>
                <Label htmlFor="import-paste" className="sr-only">
                  File content
                </Label>
                <Textarea
                  id="import-paste"
                  className="max-h-60 min-h-28 font-mono text-[13px]"
                  placeholder="Paste the file content here"
                  value={fileName ? '' : content}
                  onChange={(e) => {
                    setFileName('')
                    setContent(e.target.value)
                    preview.reset()
                  }}
                />
              </Disclosure>

              <Disclosure title="Add a Postman environment file (optional)" summary={envName || undefined} defaultOpen={!!envName}>
                <div className="grid gap-2">
                  <p className="text-sm text-muted-foreground">
                    A Postman environment holds the values of {'{{variables}}'}, such as the base URL. They become variables of the imported server.
                  </p>
                  <Input type="file" accept=".json" aria-label="Postman environment file" onChange={(e) => void readFile(e.target.files?.[0], true)} />
                </div>
              </Disclosure>

              {(fileError || previewErr) && <p className="text-sm text-destructive">{fileError ?? previewErr}</p>}
            </>
          ) : (
            <>
              <p className="text-sm">
                Found a <span className="font-medium">{formats[p.format]}</span> with {p.tests.length} test{p.tests.length === 1 ? '' : 's'} and {requests} request{requests === 1 ? '' : 's'}.
              </p>

              <div className="grid gap-2">
                <Label>Where to put it</Label>
                <RadioGroup value={target} onValueChange={(v) => setTarget(v as 'new' | 'existing')} className="gap-0 divide-y rounded-lg border">
                  <Label htmlFor="import-new" className="flex cursor-pointer items-center gap-3 p-3 font-normal">
                    <RadioGroupItem id="import-new" value="new" />
                    New project
                  </Label>
                  {hasProjects && (
                    <Label htmlFor="import-existing" className="flex cursor-pointer items-center gap-3 p-3 font-normal">
                      <RadioGroupItem id="import-existing" value="existing" />
                      Add to existing project
                    </Label>
                  )}
                </RadioGroup>
                {target === 'new' ? (
                  <Input aria-label="Project name" value={projectName} onChange={(e) => setProjectName(e.target.value)} />
                ) : (
                  <Select value={chosenExisting} onValueChange={setExisting}>
                    <SelectTrigger aria-label="Project" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {projects.data?.map((pr) => (
                        <SelectItem key={pr.id} value={String(pr.id)}>
                          {pr.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                {target === 'existing' && <p className="text-sm text-muted-foreground">A server with the same name is reused as it is. Tests with a name that is taken get a number, like "Orders (2)".</p>}
              </div>

              {p.servers.length > 0 && (
                <div className="grid gap-2">
                  <Label>Servers</Label>
                  <ul className="grid gap-1 text-sm">
                    {p.servers.map((s) => (
                      <li key={s.name} className="min-w-0">
                        <span className="font-medium">{s.name}</span>
                        {s.baseUrl && <span className="ml-2 font-mono text-[13px] break-all text-muted-foreground">{s.baseUrl}</span>}
                        {s.variables > 0 && <span className="text-muted-foreground">, {s.variables} variable{s.variables === 1 ? '' : 's'}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="grid gap-2">
                <Label>Tests</Label>
                {p.tests.map((t, ti) => (
                  <Disclosure key={`${t.name}-${ti}`} title={t.name} summary={`${t.requests.length} request${t.requests.length === 1 ? '' : 's'}`}>
                    <ul className="grid gap-1.5">
                      {t.requests.map((r, i) => (
                        <li key={i} className="flex min-w-0 items-baseline gap-2 text-sm">
                          <span className="w-16 shrink-0 font-mono text-xs text-muted-foreground">{r.method}</span>
                          <span className="min-w-0">
                            <span className="block break-words">{r.name}</span>
                            <span className="block font-mono text-xs break-all text-muted-foreground">{r.url}</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </Disclosure>
                ))}
              </div>

              {p.warnings.length > 0 && (
                <Alert>
                  <TriangleAlertIcon />
                  <AlertTitle>
                    {p.warnings.length} thing{p.warnings.length === 1 ? '' : 's'} could not be imported exactly
                  </AlertTitle>
                  <AlertDescription>
                    <p>Everything else is imported as shown above.</p>
                    <ul className="mt-2 grid list-disc gap-1 pl-4">
                      {p.warnings.map((w, i) => (
                        <li key={i} className="break-words">
                          {w}
                        </li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              )}

              {saveErr && <p className="text-sm text-destructive">{saveErr}</p>}
            </>
          )}

          <DialogFooter>
            {p ? (
              <Button type="button" variant="outline" onClick={() => { preview.reset(); save.reset() }}>
                Back
              </Button>
            ) : (
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
            )}
            {p ? (
              <Button type="submit" disabled={save.isPending || (target === 'new' ? !projectName.trim() : !chosenExisting)}>
                {save.isPending ? 'Importing' : `Import ${p.tests.length} test${p.tests.length === 1 ? '' : 's'}`}
              </Button>
            ) : (
              <Button type="submit" disabled={preview.isPending || !content.trim()}>
                {preview.isPending ? 'Reading' : 'Next'}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
