import { useMutation } from '@tanstack/react-query'
import { api, ApiError } from '@/api/client'
import type { Step, TryResult } from '@/api/types'

/** Sends one real request with the current (unsaved) settings. */
export function useTry(onValidationError: (e: ApiError) => void) {
  return useMutation({
    mutationFn: (v: { step: Step; environmentId: number | null; variant: number }) => api<TryResult>('POST', '/tools/try', v),
    onError: (e) => e instanceof ApiError && e.details.length && onValidationError(e),
  })
}
