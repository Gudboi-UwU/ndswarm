import type { ReactNode } from 'react'

/** Centered single-column frame for setup, login and fatal states. */
export function FullPage({ children }: { children: ReactNode }) {
  return (
    <main className="grid min-h-dvh place-items-center bg-background px-4 py-12">
      <div className="w-full max-w-sm">{children}</div>
    </main>
  )
}

export function Brand() {
  return <p className="font-mono text-sm font-semibold tracking-tight text-primary">ndswarm</p>
}
