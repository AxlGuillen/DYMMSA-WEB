'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import type {
  Quotation,
  QuotationWithItems,
  QuotationWithCount,
  QuotationItemRow,
  QuotationStatus,
} from '@/types/database'

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
        query = query.ilike('customer_name', `%${search}%`)
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
    mutationFn: async (id: string): Promise<{ approval_token: string }> => {
      const response = await fetch(`/api/quotations/${id}/send-for-approval`, {
        method: 'POST',
      })
      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.message || 'Error al enviar a aprobación')
      }
      return response.json()
    },
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: QUOTATIONS_KEY })
      queryClient.invalidateQueries({ queryKey: [...QUOTATIONS_KEY, id] })
    },
  })
}

// ------------------------------------------------------------------ //
// Update quotation (draft only)                                      //
// ------------------------------------------------------------------ //

export interface UpdateQuotationInput {
  id: string
  customer_name: string
  items: QuotationItemRow[]
}

export function useUpdateQuotation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ id, customer_name, items }: UpdateQuotationInput) => {
      const response = await fetch(`/api/quotations/${id}/update`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customer_name, items }),
      })
      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.message || 'Error al actualizar la cotización')
      }
      return response.json()
    },
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
    mutationFn: async (
      input: SaveQuotationInput
    ): Promise<SaveQuotationResponse> => {
      const response = await fetch('/api/quotations/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.message || 'Error al guardar la cotización')
      }

      return response.json()
    },
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
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/quotations/${id}`, { method: 'DELETE' })
      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.message || 'Error al eliminar la cotización')
      }
      return response.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUOTATIONS_KEY })
    },
  })
}

export function useCreateOrderFromQuotation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (quotationId: string): Promise<CreateOrderFromQuotationResponse> => {
      const response = await fetch(`/api/quotations/${quotationId}/create-order`, {
        method: 'POST',
      })
      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.message || 'Error al generar la orden')
      }
      return response.json()
    },
    onSuccess: (_, quotationId) => {
      queryClient.invalidateQueries({ queryKey: QUOTATIONS_KEY })
      queryClient.invalidateQueries({ queryKey: [...QUOTATIONS_KEY, quotationId] })
    },
  })
}
