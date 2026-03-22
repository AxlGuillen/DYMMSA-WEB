'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import type { StoreInventory, StoreInventoryInsert, StoreInventoryUpdate } from '@/types/database'

const INVENTORY_KEY = ['inventory']

export type StockFilter = 'all' | 'in_stock' | 'low_stock' | 'sin_stock'
export type QuantitySort = 'asc' | 'desc' | null

interface InventoryParams {
  page?: number
  pageSize?: number
  search?: string
  stockFilter?: StockFilter
  quantitySort?: QuantitySort
}

interface InventoryResponse {
  data: StoreInventory[]
  count: number
  page: number
  pageSize: number
  totalPages: number
}

export function useInventory(params: InventoryParams = {}) {
  const { page = 1, pageSize = 20, search = '', stockFilter = 'all', quantitySort = null } = params
  const supabase = createClient()

  return useQuery({
    queryKey: [...INVENTORY_KEY, { page, pageSize, search, stockFilter, quantitySort }],
    queryFn: async (): Promise<InventoryResponse> => {
      let query = supabase
        .from('store_inventory')
        .select('*', { count: 'exact' })

      if (search) {
        query = query.ilike('model_code', `%${search}%`)
      }

      if (stockFilter === 'sin_stock') {
        query = query.eq('quantity', 0)
      } else if (stockFilter === 'low_stock') {
        query = query.gt('quantity', 0).lte('quantity', 5)
      } else if (stockFilter === 'in_stock') {
        query = query.gt('quantity', 5)
      }

      const from = (page - 1) * pageSize
      const to = from + pageSize - 1

      const orderCol = quantitySort ? 'quantity' : 'model_code'
      const ascending = quantitySort ? quantitySort === 'asc' : true

      const { data, error, count } = await query
        .order(orderCol, { ascending })
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

interface InventoryStats {
  total: number
  in_stock: number
  low_stock: number
  sin_stock: number
}

export function useInventoryStats() {
  const supabase = createClient()

  return useQuery({
    queryKey: [...INVENTORY_KEY, 'stats'],
    queryFn: async (): Promise<InventoryStats> => {
      const { data, error } = await supabase
        .from('store_inventory')
        .select('quantity')

      if (error) throw error

      const items = data || []
      return {
        total:     items.length,
        sin_stock: items.filter((i) => i.quantity === 0).length,
        low_stock: items.filter((i) => i.quantity > 0 && i.quantity <= 5).length,
        in_stock:  items.filter((i) => i.quantity > 5).length,
      }
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
