import { ActivityIcon } from 'lucide-react'

export function DashboardPage() {
  return (
    <div className="max-w-5xl">
      <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
      <div className="mt-8 flex flex-col items-start gap-3 rounded-lg border border-dashed p-8">
        <ActivityIcon className="size-5 text-primary" />
        <h2 className="font-medium">No runs yet</h2>
        <p className="max-w-[60ch] text-sm text-muted-foreground">
          Live results, recent runs and trends appear here once a test has run.
        </p>
      </div>
    </div>
  )
}
