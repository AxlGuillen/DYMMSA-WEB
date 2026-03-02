'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import type {
  Quotation,
  QuotationWithItems,
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
  data: Quotation[]
  count: number
  page: number
  pageSize: number
  totalPages: number
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
        .select('*', { count: 'exact' })

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

      return {
        data:       data || [],
        count:      count || 0,
        page,
        pageSize,
        totalPages: Math.ceil((count || 0) / pageSize),
      }
    },
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
