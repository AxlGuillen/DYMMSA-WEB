'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchJson } from '@/lib/fetch-json'
import type { PayableInsert, PayableUpdate, PayableWithSupplier } from '@/types/database'
import type { PayablesMonthSummary } from '@/lib/payables'

export const PAYABLES_KEY = ['payables']

export type PayableSortField = 'due_date' | 'invoice_date' | 'amount' | 'created_at'

interface PayablesListParams {
  page?: number
  pageSize?: number
  search?: string
  status?: string
  month?: string
  sortField?: PayableSortField
  sortDir?: 'asc' | 'desc'
}

interface PayablesListResponse {
  data: PayableWithSupplier[]
  count: number
  page: number
  pageSize: number
  totalPages: number
}

export function usePayables(params: PayablesListParams = {}) {
  const { page = 1, pageSize = 20, search = '', status = '', month = '', sortField = 'due_date', sortDir = 'asc' } = params

  return useQuery({
    queryKey: [...PAYABLES_KEY, { page, pageSize, search, status, month, sortField, sortDir }],
    queryFn: () => {
      const qs = new URLSearchParams({ page: String(page), pageSize: String(pageSize), sortField, sortDir })
      if (search) qs.set('search', search)
      if (status) qs.set('status', status)
      if (month) qs.set('month', month)
      return fetchJson<PayablesListResponse>(`/api/payables?${qs}`)
    },
  })
}

interface PayablesOverviewResponse {
  month: string
  summary: PayablesMonthSummary
  payables: PayableWithSupplier[]
}

export function usePayablesOverview(month: string) {
  return useQuery({
    queryKey: [...PAYABLES_KEY, 'overview', month],
    queryFn: () => fetchJson<PayablesOverviewResponse>(`/api/payables/overview?month=${month}`),
  })
}

export function useCreatePayable() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payable: Omit<PayableInsert, 'status' | 'paid_at'>) =>
      fetchJson<PayableWithSupplier>('/api/payables', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payable),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: PAYABLES_KEY }),
  })
}

export function useUpdatePayable() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: PayableUpdate }) =>
      fetchJson<PayableWithSupplier>(`/api/payables/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(updates),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: PAYABLES_KEY }),
  })
}

export function useDeletePayable() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => fetchJson<{ ok: true }>(`/api/payables/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: PAYABLES_KEY }),
  })
}
