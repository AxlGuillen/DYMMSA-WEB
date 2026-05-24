'use client'

import { useMutation } from '@tanstack/react-query'
import type { EtmProduct } from '@/types/database'

interface LookupResponse {
  found: EtmProduct[]
  notFound: string[]
}

/**
 * Hook para buscar ETMs en la base de datos
 */
export function useLookupEtms() {
  // Lookup-only mutation: it reads matching ETMs and mutates no server state,
  // so there is no cache to invalidate.
  // oxlint-disable-next-line react-doctor/query-mutation-missing-invalidation
  return useMutation({
    mutationFn: async (etmCodes: string[]): Promise<LookupResponse> => {
      const response = await fetch('/api/quotes/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ etmCodes }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.message || 'Error en la busqueda')
      }

      return response.json()
    },
  })
}
