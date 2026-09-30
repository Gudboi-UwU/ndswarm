import { PageHeader, useTitle } from '@/components/page'
import { RunsView } from '@/components/run-table'

export function RunsPage() {
  useTitle('Runs')
  return (
    <div className="max-w-6xl">
      <PageHeader title="Runs" description="Every run of every test. Open one to see its charts, failures and logged requests." />
      <RunsView />
    </div>
  )
}
