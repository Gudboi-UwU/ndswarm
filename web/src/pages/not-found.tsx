import { Link } from 'react-router'
import { Button } from '@/components/ui/button'

export function NotFoundPage() {
  return (
    <div className="max-w-md">
      <h1 className="text-xl font-semibold">Page not found</h1>
      <p className="mt-2 text-sm text-muted-foreground">The link may be old, or the item was deleted.</p>
      <Button variant="outline" className="mt-6" asChild>
        <Link to="/">Back to dashboard</Link>
      </Button>
    </div>
  )
}
