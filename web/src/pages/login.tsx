import { Link, Navigate, useSearchParams } from 'react-router'
import { useMe } from '@/api/auth'
import { Button } from '@/components/ui/button'
import { safeNext } from '@/lib/safe-next'
import { AuthForm } from './auth-form'

export function LoginPage() {
  const me = useMe()
  const [params] = useSearchParams()
  if (me.data?.setupRequired) return <Navigate to="/setup" replace />
  if (me.data?.user) return <Navigate to={safeNext(params)} replace />
  const guest = me.data && me.data.guestMode !== 'off'

  return (
    <AuthForm
      endpoint="/auth/login"
      title="Log in"
      intro="Use the account your ndswarm admin created for you."
      submit="Log in"
      footer={
        guest && (
          <div className="mt-6 border-t pt-6">
            <Button variant="outline" className="w-full" asChild>
              <Link to="/">Continue as guest</Link>
            </Button>
            <p className="mt-2 text-center text-xs text-muted-foreground">
              {me.data?.guestMode === 'run' ? 'Guests can view results and start existing tests.' : 'Guests can view results only.'}
            </p>
          </div>
        )
      }
    />
  )
}
