'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { ApiError, fetchJson } from '@/lib/fetch-json'
import type {
  Quotation,
  QuotationWithItems,
  QuotationWithCount,
  QuotationItemRow,
  QuotationStatus,
} from '@/types/database'

// Re-export para los consumidores que ya importaban ApiError desde este módulo
// (QuotationDetail, quoter/page). El wrapper vive ahora en '@/lib/fetch-json'.
export { ApiError, fetchJson }

// ------------------------------------------------------------------ //
// Keys                                                                //
// ------------------------------------------------------------------ //

const QUOTATIONS_KEY = ['quotations']

// ------------------------------------------------------------------ //
// Query types                                                         //
// ------------------------------------------------------------------ //

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

// ------------------------------------------------------------------ //
// Queries                                                             //
// ------------------------------------------------------------------ //

export function useQuotations(params: QuotationsParams = {}) {
  const { page = 1, pageSize = 20, search = '', status = 'all' } = params
  const supabase = createClient()

  return useQuery({
    queryKey: [...QUOTATIONS_KEY, { page, pageSize, search, status }],
    queryFn: async (): Promise<QuotationsResponse> => {
      let query = supabase
        .from('quotations')
        .select('*, quotation_items(count)', { count: 'exact' })

      if (search) {
        query = query.or(`customer_name.ilike.%${search}%,name.ilike.%${search}%`)
      }

      if (status !== 'all') {
        query = query.eq('status', status)
      }

      const from = (page - 1) * pageSize
      const to   = from + pageSize - 1

      const { data, error, count } = await query
        .order('created_at', { ascending: false })
        .range(from, to)

      if (error) throw error

      const mapped: QuotationWithCount[] = (data || []).map((q) => {
        const raw = q as Quotation & { quotation_items: [{ count: number }] | null }
        return {
          ...q,
          items_count: raw.quotation_items?.[0]?.count ?? 0,
        }
      })

      return {
        data:       mapped,
        count:      count || 0,
        page,
        pageSize,
        totalPages: Math.ceil((count || 0) / pageSize),
      }
    },
  })
}

// ------------------------------------------------------------------ //
// Stats by status                                                     //
// ------------------------------------------------------------------ //

export function useQuotationStats() {
  const supabase = createClient()

  return useQuery({
    queryKey: [...QUOTATIONS_KEY, 'stats'],
    queryFn: async (): Promise<QuotationStats> => {
      const { data, error } = await supabase
        .from('quotations')
        .select('status')

      if (error) throw error

      const stats: QuotationStats = {
        draft: 0,
        sent_for_approval: 0,
        approved: 0,
        rejected: 0,
        converted_to_order: 0,
      }

      data?.forEach((q) => {
        const s = q.status as QuotationStatus
        if (s in stats) stats[s]++
      })

      return stats
    },
    staleTime: 30_000,
  })
}

// ------------------------------------------------------------------ //
// Single quotation                                                    //
// ------------------------------------------------------------------ //

export function useQuotation(id: string) {
  const supabase = createClient()

  return useQuery({
    queryKey: [...QUOTATIONS_KEY, id],
    queryFn: async (): Promise<QuotationWithItems | null> => {
      const { data, error } = await supabase
        .from('quotations')
        .select('*, quotation_items(*)')
        .eq('id', id)
        .order('sort_order', { foreignTable: 'quotation_items', ascending: true })
        .limit(5000, { foreignTable: 'quotation_items' })
        .single()

      if (error) throw error
      return data
    },
    enabled: !!id,
  })
}

// ------------------------------------------------------------------ //
// Send for approval                                                   //
// ------------------------------------------------------------------ //

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

// ------------------------------------------------------------------ //
// Change status (manual revert / lateral move)                        //
// ------------------------------------------------------------------ //

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

// ------------------------------------------------------------------ //
// Update quotation (draft only)                                      //
// ------------------------------------------------------------------ //

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

// ------------------------------------------------------------------ //
// Types                                                               //
// ------------------------------------------------------------------ //

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

// ------------------------------------------------------------------ //
// Hooks                                                               //
// ------------------------------------------------------------------ //

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

// ------------------------------------------------------------------ //
// Create order from approved quotation                              //
// ------------------------------------------------------------------ //

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
