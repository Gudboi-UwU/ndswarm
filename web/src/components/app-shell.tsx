import { useMutation, useQueryClient } from '@tanstack/react-query'
import { FolderIcon, GaugeIcon, LogInIcon, LogOutIcon, MoonIcon, SettingsIcon, SunIcon } from 'lucide-react'
import { useTheme } from 'next-themes'
import { Link, Navigate, NavLink, Outlet, useLocation, useNavigate } from 'react-router'
import { useMe } from '@/api/auth'
import { api, errorMessage } from '@/api/client'
import type { Me } from '@/api/types'
import { Brand, FullPage } from '@/components/full-page'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

/** Sends visitors to /setup or /login until they may view the app. */
export function RequireAccess() {
  const me = useMe()
  const location = useLocation()

  if (me.isPending) {
    return (
      <div className="flex min-h-dvh">
        <Skeleton className="hidden w-56 rounded-none md:block" />
        <div className="flex-1 space-y-4 p-8">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-32 w-full max-w-3xl" />
        </div>
      </div>
    )
  }
  if (me.isError) {
    return (
      <FullPage>
        <Brand />
        <h1 className="mt-6 text-xl font-semibold">Cannot load ndswarm</h1>
        <p className="mt-2 text-sm text-muted-foreground">{errorMessage(me.error)}</p>
        <Button className="mt-6" onClick={() => void me.refetch()}>
          Try again
        </Button>
      </FullPage>
    )
  }
  if (me.data.setupRequired) return <Navigate to="/setup" replace />
  if (!me.data.can.view) {
    const next = location.pathname + location.search
    return <Navigate to={next === '/' ? '/login' : `/login?next=${encodeURIComponent(next)}`} replace />
  }
  return <Outlet />
}

const nav = [
  { to: '/', label: 'Dashboard', icon: GaugeIcon, show: () => true },
  { to: '/projects', label: 'Projects', icon: FolderIcon, show: () => true },
  { to: '/settings', label: 'Settings', icon: SettingsIcon, show: (me: Me) => me.can.admin },
]

export function AppShell() {
  const { data: me } = useMe()
  if (!me) return null
  const items = nav.filter((n) => n.show(me))

  return (
    <div className="flex min-h-dvh flex-col bg-background md:flex-row">
      <aside className="flex shrink-0 items-center gap-1 border-b bg-sidebar px-3 py-2 md:w-56 md:flex-col md:items-stretch md:border-r md:border-b-0 md:px-3 md:py-4">
        <Link to="/" className="px-2 py-1 md:mb-6">
          <Brand />
        </Link>
        <nav className="flex flex-1 gap-1 md:flex-col">
          {items.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground',
                  isActive && 'bg-sidebar-accent font-medium text-sidebar-foreground',
                )
              }
            >
              <Icon className="size-4" />
              <span className="hidden sm:inline">{label}</span>
            </NavLink>
          ))}
        </nav>
        <AccountMenu me={me} />
      </aside>
      <main className="min-w-0 flex-1 px-4 py-6 md:px-8 md:py-8">
        <Outlet />
      </main>
    </div>
  )
}

function AccountMenu({ me }: { me: Me }) {
  const { resolvedTheme, setTheme } = useTheme()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const logout = useMutation({
    mutationFn: () => api<void>('POST', '/auth/logout'),
    onSettled: async () => {
      queryClient.clear()
      await navigate('/login')
    },
  })
  const dark = resolvedTheme === 'dark'
  const name = me.user ? me.user.username : 'Guest'
  const detail = me.user ? me.user.role : me.guestMode === 'run' ? 'view and run' : 'view only'

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" aria-label={`Account: ${name}`} className="h-auto justify-start gap-2 px-2 py-1.5 text-left">
          <span className="grid size-6 shrink-0 place-items-center rounded-md bg-primary/15 font-mono text-xs font-semibold text-primary uppercase">
            {name[0]}
          </span>
          <span className="hidden min-w-0 md:block">
            <span className="block truncate text-sm">{name}</span>
            <span className="block text-xs text-muted-foreground capitalize">{detail}</span>
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel className="font-normal">
          <span className="block text-sm">{name}</span>
          <span className="block text-xs text-muted-foreground capitalize">{detail}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => setTheme(dark ? 'light' : 'dark')}>
          {dark ? <SunIcon /> : <MoonIcon />}
          {dark ? 'Light theme' : 'Dark theme'}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {me.user ? (
          <DropdownMenuItem onSelect={() => logout.mutate()}>
            <LogOutIcon />
            Log out
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem asChild>
            <Link to="/login">
              <LogInIcon />
              Log in
            </Link>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
