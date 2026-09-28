import '@/index.css'
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from 'next-themes'
import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router'
import { meKey } from '@/api/auth'
import { ApiError } from '@/api/client'
import { AppShell, RequireAccess } from '@/components/app-shell'
import { Toaster } from '@/components/ui/sonner'
import { DashboardPage } from '@/pages/dashboard'
import { LoginPage } from '@/pages/login'
import { NotFoundPage } from '@/pages/not-found'
import { ProjectPage } from '@/pages/project'
import { ProjectsPage } from '@/pages/projects'
import { SettingsPage } from '@/pages/settings'
import { SetupPage } from '@/pages/setup'

// The builder pulls in CodeMirror; load it only when a test is opened.
const TestBuilderPage = lazy(() => import('@/pages/test-builder'))

// A 401 anywhere means the session ended: refetch /auth/me so the gate redirects to /login.
const onError = (err: unknown) => {
  if (err instanceof ApiError && err.status === 401) void queryClient.invalidateQueries({ queryKey: meKey })
}
const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError }),
  mutationCache: new MutationCache({ onError }),
  defaultOptions: {
    queries: { retry: (n, err) => !(err instanceof ApiError && err.status < 500 && err.status > 0) && n < 2 },
  },
})

const router = createBrowserRouter([
  { path: '/setup', element: <SetupPage /> },
  { path: '/login', element: <LoginPage /> },
  {
    element: <RequireAccess />,
    children: [
      {
        element: <AppShell />,
        children: [
          { index: true, element: <DashboardPage /> },
          { path: 'projects', element: <ProjectsPage /> },
          { path: 'projects/:id', element: <ProjectPage /> },
          {
            path: 'tests/:id',
            element: (
              <Suspense fallback={null}>
                <TestBuilderPage />
              </Suspense>
            ),
          },
          { path: 'settings', element: <SettingsPage /> },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
])

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
        <Toaster position="bottom-right" />
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
)
