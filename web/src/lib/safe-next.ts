/** The ?next= target after login, limited to same-origin paths (no open redirect). */
export function safeNext(params: URLSearchParams): string {
  const next = params.get('next')
  return next?.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') ? next : '/'
}
