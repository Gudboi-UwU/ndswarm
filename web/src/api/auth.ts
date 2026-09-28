import { useQuery } from '@tanstack/react-query'
import { api } from './client'
import type { Me } from './types'

export const meKey = ['auth', 'me'] as const

export function useMe() {
  return useQuery({ queryKey: meKey, queryFn: () => api<Me>('GET', '/auth/me'), staleTime: 30_000 })
}
