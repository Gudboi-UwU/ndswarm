import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent, type ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { meKey } from '@/api/auth'
import { api, ApiError, errorMessage } from '@/api/client'
import type { User } from '@/api/types'
import { FormField } from '@/components/form-field'
import { Brand, FullPage } from '@/components/full-page'
import { useTitle } from '@/components/page'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { safeNext } from '@/lib/safe-next'

interface Props {
  endpoint: '/auth/setup' | '/auth/login'
  title: string
  intro: string
  submit: string
  newPassword?: boolean
  footer?: ReactNode
}

/** Username + password form shared by first-run setup and login. */
export function AuthForm({ endpoint, title, intro, submit, newPassword, footer }: Props) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const mutation = useMutation({
    mutationFn: () => api<{ user: User }>('POST', endpoint, { username, password }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: meKey })
      await navigate(safeNext(params), { replace: true })
    },
  })
  const err = mutation.error instanceof ApiError ? mutation.error : null
  const formError = mutation.error && !err?.details.length ? errorMessage(mutation.error) : null
  useTitle(title)

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    mutation.mutate()
  }

  return (
    <FullPage>
      <Brand />
      <h1 className="mt-6 text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{intro}</p>
      <form onSubmit={onSubmit} className="mt-8 grid gap-5" noValidate>
        {formError && (
          <Alert variant="destructive">
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        )}
        <FormField
          id="username"
          label="Username"
          autoComplete="username"
          autoFocus
          required
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          error={err?.field('username')}
        />
        <FormField
          id="password"
          label="Password"
          type="password"
          autoComplete={newPassword ? 'new-password' : 'current-password'}
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={err?.field('password')}
          hint={newPassword ? 'At least 8 characters.' : undefined}
        />
        <Button type="submit" size="lg" disabled={mutation.isPending || !username || !password}>
          {mutation.isPending ? 'Please wait' : submit}
        </Button>
      </form>
      {footer}
    </FullPage>
  )
}
