'use client'

import { useMutation } from '@tanstack/react-query'
import type { EtmProduct } from '@/types/database'

interface LookupResponse {
  found: EtmProduct[]
  notFound: string[]
  // Indexed by catalogKey, not by code (ADR-013).
  catalogDescriptions: Record<string, string>
}

interface LookupInput {
  etmCodes: string[]
  // Resolve catalog descriptions for rows not yet in etm_products.
  modelCodes?: string[]
}

export function useLookupEtms() {
  // Lookup-only: reads ETMs, mutates no server state, so nothing to invalidate.
  // oxlint-disable-next-line react-doctor/query-mutation-missing-invalidation
  return useMutation({
    mutationFn: async ({ etmCodes, modelCodes }: LookupInput): Promise<LookupResponse> => {
      const response = await fetch('/api/quotes/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ etmCodes, modelCodes }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.message || 'Error en la busqueda')
      }

      return response.json()
    },
  })
}
