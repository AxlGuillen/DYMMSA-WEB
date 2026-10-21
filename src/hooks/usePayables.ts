'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchJson } from '@/lib/fetch-json'
import type { AuditEvent, PayableCurrency, PayableInsert, PayableUpdate, PayableWithSupplier } from '@/types/database'
import type { PayableTotals, PayablesMonthSummary } from '@/lib/payables'

export const PAYABLES_KEY = ['payables']

export type PayableSortField = 'due_date' | 'invoice_date' | 'amount' | 'created_at'

interface PayablesListParams {
  page?: number
  pageSize?: number
  search?: string
  status?: string
  month?: string
  supplier?: string
  minAmount?: string
  maxAmount?: string
  sortField?: PayableSortField
  sortDir?: 'asc' | 'desc'
}

interface PayablesListResponse {
  data: PayableWithSupplier[]
  count: number
  page: number
  pageSize: number
  totalPages: number
  /** Footer total of every filtered row, per currency (2026-10-20). */
  totals: PayableTotals & { truncated: boolean }
}

export function usePayables(params: PayablesListParams = {}) {
  const {
    page = 1, pageSize = 20, search = '', status = '', month = '',
    supplier = '', minAmount = '', maxAmount = '', sortField = 'due_date', sortDir = 'asc',
  } = params

  return useQuery({
    queryKey: [...PAYABLES_KEY, { page, pageSize, search, status, month, supplier, minAmount, maxAmount, sortField, sortDir }],
    queryFn: () => {
      const qs = new URLSearchParams({ page: String(page), pageSize: String(pageSize), sortField, sortDir })
      if (search) qs.set('search', search)
      if (status) qs.set('status', status)
      if (month) qs.set('month', month)
      if (supplier) qs.set('supplier', supplier)
      if (minAmount) qs.set('minAmount', minAmount)
      if (maxAmount) qs.set('maxAmount', maxAmount)
      return fetchJson<PayablesListResponse>(`/api/payables?${qs}`)
    },
  })
}

interface PayablesOverviewResponse {
  month: string
  /** Pesos only: the closing math never mixes currencies. */
  summary: PayablesMonthSummary
  /** Same summary per other currency, never converted (2026-10-20). */
  foreign: Partial<Record<PayableCurrency, PayablesMonthSummary>>
  payables: PayableWithSupplier[]
  /** The pending read hit its limit: carry-over and the projected closing may be short. */
  pendingTruncated: boolean
  /** The paid read hit its limit: the real closing may be short. */
  paidTruncated: boolean
}

/** Admin only: the hook is gated by `enabled` and the route answers 403 to a member (ADR-028). */
export function usePayableEvents(id: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: [...PAYABLES_KEY, 'events', id],
    queryFn: () => fetchJson<AuditEvent[]>(`/api/payables/${id}/events`),
    enabled: enabled && !!id,
  })
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
