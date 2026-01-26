'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import type { StoreInventory, StoreInventoryInsert, StoreInventoryUpdate } from '@/types/database'

const INVENTORY_KEY = ['inventory']

interface InventoryParams {
  page?: number
  pageSize?: number
  search?: string
}

interface InventoryResponse {
  data: StoreInventory[]
  count: number
  page: number
  pageSize: number
  totalPages: number
}

export function useInventory(params: InventoryParams = {}) {
  const { page = 1, pageSize = 20, search = '' } = params
  const supabase = createClient()

  return useQuery({
    queryKey: [...INVENTORY_KEY, { page, pageSize, search }],
    queryFn: async (): Promise<InventoryResponse> => {
      let query = supabase
        .from('store_inventory')
        .select('*', { count: 'exact' })

      if (search) {
        query = query.ilike('model_code', `%${search}%`)
      }

      const from = (page - 1) * pageSize
      const to = from + pageSize - 1

      const { data, error, count } = await query
        .order('model_code', { ascending: true })
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

export function useCreateInventoryItem() {
  const queryClient = useQueryClient()
  const supabase = createClient()

  return useMutation({
    mutationFn: async (item: StoreInventoryInsert) => {
      const { data, error } = await supabase
        .from('store_inventory')
        .insert(item)
        .select()
        .single()

      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: INVENTORY_KEY })
    },
  })
}

export function useUpdateInventoryItem() {
  const queryClient = useQueryClient()
  const supabase = createClient()

  return useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: StoreInventoryUpdate }) => {
      const { data, error } = await supabase
        .from('store_inventory')
        .update(updates)
        .eq('id', id)
        .select()
        .single()

      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: INVENTORY_KEY })
    },
  })
}

export function useDeleteInventoryItem() {
  const queryClient = useQueryClient()
  const supabase = createClient()

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('store_inventory')
        .delete()
        .eq('id', id)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: INVENTORY_KEY })
    },
  })
}

export function useImportInventory() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (formData: FormData) => {
      const response = await fetch('/api/inventory/import', {
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
      queryClient.invalidateQueries({ queryKey: INVENTORY_KEY })
    },
  })
}
