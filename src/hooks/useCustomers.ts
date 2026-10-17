'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, fetchJson } from '@/lib/fetch-json'
import { rangeQuery, type CustomerDetailResponse, type CustomersResponse, type StatementRange } from '@/lib/customers'
import { CUSTOMERS_KEY, INCOME_KEY } from './odoo-query-keys'

export { CUSTOMERS_KEY }

/** The server already caches Odoo for 15 min; 5 min here just avoids re-hitting it on every focus. */
export function useCustomers(range: StatementRange) {
  return useQuery({
    queryKey: [...CUSTOMERS_KEY, 'list', range],
    queryFn: () => fetchJson<CustomersResponse>(`/api/clients?${rangeQuery(range)}`),
    staleTime: 5 * 60_000,
  })
}

export function useCustomer(id: string, range: StatementRange) {
  return useQuery({
    queryKey: [...CUSTOMERS_KEY, 'detail', id, range],
    queryFn: () => fetchJson<CustomerDetailResponse>(`/api/clients/${id}?${rangeQuery(range)}`),
    staleTime: 5 * 60_000,
    // A 404 is an answer, not a hiccup: retrying it only delays "Cliente no encontrado".
    retry: (count, error) => !(error instanceof ApiError && error.status === 404) && count < 3,
  })
}

/** Purges the server cache, then refetches every customer view; Finanzas shares the open receivables. */
export function useRefreshCustomers() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => fetchJson<{ ok: true }>('/api/clients/refresh', { method: 'POST' }),
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: INCOME_KEY, refetchType: 'none' })
      await queryClient.invalidateQueries({ queryKey: CUSTOMERS_KEY })
    },
  })
}
