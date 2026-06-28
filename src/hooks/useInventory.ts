'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchJson } from '@/lib/fetch-json'
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

  return useQuery({
    queryKey: [...INVENTORY_KEY, { page, pageSize, search, stockFilter, quantitySort }],
    queryFn: async (): Promise<InventoryResponse> => {
      const qs = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
        stockFilter,
      })
      if (search) qs.set('search', search)
      if (quantitySort) qs.set('quantitySort', quantitySort)
      return fetchJson<InventoryResponse>(`/api/inventory?${qs.toString()}`)
    },
  })
}

export function useCreateInventoryItem() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (item: StoreInventoryInsert) =>
      fetchJson<StoreInventory>('/api/inventory', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(item),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: INVENTORY_KEY })
    },
  })
}

export function useUpdateInventoryItem() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: StoreInventoryUpdate }) =>
      fetchJson<StoreInventory>(`/api/inventory/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(updates),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: INVENTORY_KEY })
    },
  })
}

export function useDeleteInventoryItem() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (id: string) =>
      fetchJson<{ ok: true }>(`/api/inventory/${id}`, { method: 'DELETE' }),
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
  return useQuery({
    queryKey: [...INVENTORY_KEY, 'stats'],
    queryFn: async (): Promise<InventoryStats> =>
      fetchJson<InventoryStats>('/api/inventory/stats'),
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
