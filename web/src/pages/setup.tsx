import { Navigate } from 'react-router'
import { useMe } from '@/api/auth'
import { AuthForm } from './auth-form'

export function SetupPage() {
  const me = useMe()
  if (me.data && !me.data.setupRequired) return <Navigate to="/" replace />
  return (
    <AuthForm
      endpoint="/auth/setup"
      title="Create the admin account"
      intro="This account manages users and settings. You can add more people after this step."
      submit="Create admin"
      newPassword
    />
  )
}
