'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchJson } from '@/lib/fetch-json'
import type { IncomeOverviewResponse } from '@/lib/income'

export const INCOME_KEY = ['finance', 'income']

/** The server already caches Odoo for 15 min; 5 min here just avoids re-hitting it on every focus. */
export function useIncomeOverview(month: string) {
  return useQuery({
    queryKey: [...INCOME_KEY, month],
    queryFn: () => fetchJson<IncomeOverviewResponse>(`/api/finance/income?month=${month}`),
    staleTime: 5 * 60_000,
  })
}

export function useRefreshIncome() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (month: string) =>
      fetchJson<IncomeOverviewResponse>(`/api/finance/income/refresh?month=${month}`, { method: 'POST' }),
    onSuccess: (data, month) => {
      queryClient.setQueryData([...INCOME_KEY, month], data)
      // Other months share the purged open-receivables read; mark them stale without refetching now.
      queryClient.invalidateQueries({
        queryKey: INCOME_KEY,
        refetchType: 'none',
        predicate: (q) => q.queryKey[2] !== month,
      })
    },
  })
}
