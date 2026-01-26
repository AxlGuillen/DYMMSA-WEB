'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import type { EtmProduct, EtmProductInsert, EtmProductUpdate } from '@/types/database'

const PRODUCTS_KEY = ['products']

interface ProductsParams {
  page?: number
  pageSize?: number
  search?: string
}

interface ProductsResponse {
  data: EtmProduct[]
  count: number
  page: number
  pageSize: number
  totalPages: number
}

export function useProducts(params: ProductsParams = {}) {
  const { page = 1, pageSize = 20, search = '' } = params
  const supabase = createClient()

  return useQuery({
    queryKey: [...PRODUCTS_KEY, { page, pageSize, search }],
    queryFn: async (): Promise<ProductsResponse> => {
      let query = supabase
        .from('etm_products')
        .select('*', { count: 'exact' })

      if (search) {
        query = query.or(`etm.ilike.%${search}%,modelo.ilike.%${search}%,descripcion.ilike.%${search}%,description.ilike.%${search}%`)
      }

      const from = (page - 1) * pageSize
      const to = from + pageSize - 1

      const { data, error, count } = await query
        .order('etm', { ascending: true })
        .range(from, to)

      if (error) throw error

      return {
        data: data || [],
        count: count || 0,
        page,
        pageSize,
        totalPages: Math.ceil((count || 0) / pageSize),
      }
    },
  })
}

export function useCreateProduct() {
  const queryClient = useQueryClient()
  const supabase = createClient()

  return useMutation({
    mutationFn: async (product: EtmProductInsert) => {
      const { data, error } = await supabase
        .from('etm_products')
        .insert(product)
        .select()
        .single()

      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PRODUCTS_KEY })
    },
  })
}

export function useUpdateProduct() {
  const queryClient = useQueryClient()
  const supabase = createClient()

  return useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: EtmProductUpdate }) => {
      const { data, error } = await supabase
        .from('etm_products')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single()

      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PRODUCTS_KEY })
    },
  })
}

export function useDeleteProduct() {
  const queryClient = useQueryClient()
  const supabase = createClient()

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('etm_products')
        .delete()
        .eq('id', id)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PRODUCTS_KEY })
    },
  })
}

export function useImportProducts() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (formData: FormData) => {
      const response = await fetch('/api/products/import', {
        method: 'POST',
        body: formData,
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.message || 'Import failed')
      }

      return response.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PRODUCTS_KEY })
    },
  })
}
