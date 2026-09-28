import { useQuery } from '@tanstack/react-query'
import { FlaskConicalIcon, FolderCogIcon, PlusIcon } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { useMe } from '@/api/auth'
import { api, errorMessage } from '@/api/client'
import type { TestSummary } from '@/api/types'
import { NewTestDialog } from '@/components/new-test-dialog'
import { EmptyState, PageHeader } from '@/components/page'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDate } from '@/lib/format'

type Row = TestSummary & { projectId: number; projectName: string; targetName: string; targetUrl: string }

/** Every test in one place, grouped by project. The main starting point for work. */
export function TestsPage() {
  const { data: me } = useMe()
  const tests = useQuery({ queryKey: ['tests', 'all'], queryFn: () => api<Row[]>('GET', '/tests') })
  const [creating, setCreating] = useState(false)
  const canEdit = !!me?.can.edit

  const groups = new Map<number, { name: string; rows: Row[] }>()
  for (const t of tests.data ?? []) {
    if (!groups.has(t.projectId)) groups.set(t.projectId, { name: t.projectName, rows: [] })
    groups.get(t.projectId)!.rows.push(t)
  }
  const newButton = canEdit && (
    <Button onClick={() => setCreating(true)}>
      <PlusIcon />
      New test
    </Button>
  )

  return (
    <div className="max-w-5xl">
      <PageHeader
        title="Tests"
        description="A test is a list of requests to send, and how many users send them for how long."
        actions={
          <>
            <Button variant="ghost" asChild>
              <Link to="/projects">
                <FolderCogIcon />
                Projects and targets
              </Link>
            </Button>
            {(tests.data?.length ?? 0) > 0 && newButton}
          </>
        }
      />
      {tests.isPending ? (
        <Skeleton className="h-48" />
      ) : tests.isError ? (
        <p className="text-sm text-destructive">{errorMessage(tests.error)}</p>
      ) : groups.size === 0 ? (
        <EmptyState icon={<FlaskConicalIcon />} title="No tests yet" action={newButton}>
          {canEdit ? 'Create your first test: give it a name, the address of the server, and one request to send.' : 'Nobody has created a test yet. Ask an editor to create one.'}
        </EmptyState>
      ) : (
        <div className="grid gap-8">
          {[...groups].map(([pid, g]) => (
            <section key={pid} className="grid gap-2">
              <h2 className="flex items-baseline gap-3 text-sm font-medium text-muted-foreground">
                <Link to={`/projects/${pid}`} className="hover:text-foreground">
                  {g.name}
                </Link>
              </h2>
              <ul className="divide-y rounded-lg border">
                {g.rows.map((t) => (
                  <li key={t.id} className="relative grid gap-1 px-4 py-3 hover:bg-muted/40 sm:grid-cols-[minmax(0,1fr)_14rem_8rem] sm:items-center sm:gap-4">
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
                    <p className="text-xs text-muted-foreground sm:text-right">Edited {formatDate(t.updatedAt)}</p>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
      {creating && <NewTestDialog open={creating} onOpenChange={setCreating} />}
    </div>
  )
}
