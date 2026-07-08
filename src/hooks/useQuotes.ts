'use client'

import { useMutation } from '@tanstack/react-query'
import type { EtmProduct } from '@/types/database'

interface LookupResponse {
  found: EtmProduct[]
  notFound: string[]
  // code normalizado → descripción oficial del catálogo URREA (para la
  // resolución de "Desc. DYMMSA"; incluye codes de productos encontrados
  // y los modelCodes del Excel)
  catalogDescriptions: Record<string, string>
}

interface LookupInput {
  etmCodes: string[]
  // model_codes del Excel: resuelven descripción de catálogo también en filas
  // que aún no existen en etm_products
  modelCodes?: string[]
}

/**
 * Hook para buscar ETMs en la base de datos
 */
export function useLookupEtms() {
  // Lookup-only mutation: it reads matching ETMs and mutates no server state,
  // so there is no cache to invalidate.
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
