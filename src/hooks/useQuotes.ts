'use client'

import { useQuery, useMutation } from '@tanstack/react-query'
import type { EtmProduct, Quote, QuoteInsert } from '@/types/database'

interface LookupResponse {
  found: EtmProduct[]
  notFound: string[]
}

interface QuotesHistoryParams {
  page?: number
  pageSize?: number
}

interface QuotesStats {
  totalQuotes: number
  totalEtmsRequested: number
  totalEtmsFound: number
}

interface QuotesHistoryResponse {
  data: Quote[]
  count: number
  page: number
  pageSize: number
  totalPages: number
  stats: QuotesStats
}

const QUOTES_KEY = ['quotes']

/**
 * Hook para obtener el historial de cotizaciones
 */
export function useQuotesHistory(params: QuotesHistoryParams = {}) {
  const { page = 1, pageSize = 10 } = params

  return useQuery({
    queryKey: [...QUOTES_KEY, { page, pageSize }],
    queryFn: async (): Promise<QuotesHistoryResponse> => {
      const searchParams = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      })

      const response = await fetch(`/api/quotes?${searchParams}`)

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.message || 'Error al obtener historial')
      }

      return response.json()
    },
  })
}

/**
 * Hook para buscar ETMs en la base de datos
 */
export function useLookupEtms() {
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

/**
 * Hook para guardar cotizacion en el historial
 */
export function useSaveQuote() {
  return useMutation({
    mutationFn: async (quote: Omit<QuoteInsert, 'user_id'>) => {
      const response = await fetch('/api/quotes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(quote),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.message || 'Error al guardar')
      }

      return response.json()
    },
  })
}
