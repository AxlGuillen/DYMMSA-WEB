'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchJson } from '@/lib/fetch-json'
import type { StoreInventory, StoreInventoryInsert, StoreInventoryUpdate } from '@/types/database'

const INVENTORY_KEY = ['inventory']

export type StockFilter = 'all' | 'with_stock' | 'in_stock' | 'low_stock' | 'sin_stock'
export type QuantitySort = 'asc' | 'desc' | null

/** Filter value for products whose ETM carries no brand (#53). */
export const NO_BRAND = '__none__'
/** Selector value for no brand filter. */
export const ALL_BRANDS = '__all__'

/** Inventory row with brand resolved against `etm_products` (view). */
export interface StoreInventoryWithBrand extends StoreInventory {
  brand: string | null
}

interface InventoryParams {
  page?: number
  pageSize?: number
  search?: string
  stockFilter?: StockFilter
  quantitySort?: QuantitySort
  /** Exact brand, `NO_BRAND` for none, or empty for all. */
  brand?: string
}

interface InventoryResponse {
  data: StoreInventoryWithBrand[]
  count: number
  page: number
  pageSize: number
  totalPages: number
}

export function useInventory(params: InventoryParams = {}) {
  const {
    page = 1, pageSize = 20, search = '', stockFilter = 'all',
    quantitySort = null, brand = '',
  } = params

  return useQuery({
    queryKey: [...INVENTORY_KEY, { page, pageSize, search, stockFilter, quantitySort, brand }],
    queryFn: async (): Promise<InventoryResponse> => {
      const qs = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
        stockFilter,
      })
      if (search) qs.set('search', search)
      if (quantitySort) qs.set('quantitySort', quantitySort)
      if (brand) qs.set('brand', brand)
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

export interface BrandCount {
  /** null = products whose ETM carries no brand. */
  brand: string | null
  total: number
  with_stock: number
}

interface InventoryStats {
  total: number
  with_stock: number
  in_stock: number
  low_stock: number
  sin_stock: number
  /** Brands in inventory, most to least (for the selector). */
  brands: BrandCount[]
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
