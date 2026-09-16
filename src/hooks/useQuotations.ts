'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ApiError, fetchJson } from '@/lib/fetch-json'
import type {
  Quotation,
  QuotationWithItems,
  QuotationWithCount,
  QuotationItemRow,
  QuotationStatus,
} from '@/types/database'

// Re-export: consumers still import ApiError from here (wrapper moved to '@/lib/fetch-json').
export { ApiError, fetchJson }

const QUOTATIONS_KEY = ['quotations']

interface QuotationsParams {
  page?: number
  pageSize?: number
  search?: string
  status?: QuotationStatus | 'all'
}

interface QuotationsResponse {
  data: QuotationWithCount[]
  count: number
  page: number
  pageSize: number
  totalPages: number
}

export interface QuotationStats {
  draft: number
  sent_for_approval: number
  approved: number
  rejected: number
  converted_to_order: number
}

export function useQuotations(params: QuotationsParams = {}) {
  const { page = 1, pageSize = 20, search = '', status = 'all' } = params

  return useQuery({
    queryKey: [...QUOTATIONS_KEY, { page, pageSize, search, status }],
    queryFn: async (): Promise<QuotationsResponse> => {
      const qs = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
        status,
      })
      if (search) qs.set('search', search)
      return fetchJson<QuotationsResponse>(`/api/quotations?${qs.toString()}`)
    },
  })
}

export function useQuotationStats() {
  return useQuery({
    queryKey: [...QUOTATIONS_KEY, 'stats'],
    queryFn: async (): Promise<QuotationStats> =>
      fetchJson<QuotationStats>('/api/quotations/stats'),
    staleTime: 30_000,
  })
}

export function useQuotation(id: string) {
  return useQuery({
    queryKey: [...QUOTATIONS_KEY, id],
    queryFn: async (): Promise<QuotationWithItems> =>
      fetchJson<QuotationWithItems>(`/api/quotations/${id}`),
    enabled: !!id,
  })
}

export function useSendForApproval() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string): Promise<{ approval_token: string }> =>
      fetchJson(`/api/quotations/${id}/send-for-approval`, { method: 'POST' }),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: QUOTATIONS_KEY })
      queryClient.invalidateQueries({ queryKey: [...QUOTATIONS_KEY, id] })
    },
  })
}

export function useChangeQuotationStatus() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: QuotationStatus }) =>
      fetchJson<Quotation>(`/api/quotations/${id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      }),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: QUOTATIONS_KEY })
      queryClient.invalidateQueries({ queryKey: [...QUOTATIONS_KEY, variables.id] })
    },
  })
}

export interface UpdateQuotationInput {
  id: string
  name: string
  customer_name: string
  items: QuotationItemRow[]
}

export function useUpdateQuotation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, name, customer_name, items }: UpdateQuotationInput) =>
      fetchJson(`/api/quotations/${id}/update`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, customer_name, items }),
      }),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: QUOTATIONS_KEY })
      queryClient.invalidateQueries({ queryKey: [...QUOTATIONS_KEY, variables.id] })
    },
  })
}

export interface SaveQuotationInput {
  name: string
  customer_name: string
  items: QuotationItemRow[]
}

export interface SaveQuotationResponse {
  quotation_id: string
  total_amount: number
  items_count: number
  auto_learn: {
    added: number
    updated: number
    skipped: number
  }
}

export function useSaveQuotation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: SaveQuotationInput): Promise<SaveQuotationResponse> =>
      fetchJson('/api/quotations/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUOTATIONS_KEY })
    },
  })
}

export interface CreateOrderFromQuotationResponse {
  order_id: string
  items_count: number
  total_amount: number
}

export function useDeleteQuotation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) =>
      fetchJson(`/api/quotations/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUOTATIONS_KEY })
    },
  })
}

export function useCreateOrderFromQuotation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (quotationId: string): Promise<CreateOrderFromQuotationResponse> =>
      fetchJson(`/api/quotations/${quotationId}/create-order`, { method: 'POST' }),
    onSuccess: (_, quotationId) => {
      queryClient.invalidateQueries({ queryKey: QUOTATIONS_KEY })
      queryClient.invalidateQueries({ queryKey: [...QUOTATIONS_KEY, quotationId] })
    },
  })
}
