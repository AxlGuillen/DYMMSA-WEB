'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchJson } from '@/lib/fetch-json'
import type { EtmProduct, EtmProductInsert, EtmProductUpdate } from '@/types/database'

const PRODUCTS_KEY = ['products']

export type ProductSortBy = 'etm' | 'description_es' | 'model_code' | 'price'
export type SortDir = 'asc' | 'desc'

interface ProductsParams {
  page?: number
  pageSize?: number
  search?: string
  sortBy?: ProductSortBy
  sortDir?: SortDir
}

interface ProductsResponse {
  data: EtmProduct[]
  count: number
  page: number
  pageSize: number
  totalPages: number
}

const jsonInit = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

export function useProducts(params: ProductsParams = {}) {
  const { page = 1, pageSize = 20, search = '', sortBy = 'etm', sortDir = 'asc' } = params

  return useQuery({
    queryKey: [...PRODUCTS_KEY, { page, pageSize, search, sortBy, sortDir }],
    queryFn: () => {
      const qs = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
        sortBy,
        sortDir,
      })
      if (search) qs.set('search', search)
      return fetchJson<ProductsResponse>(`/api/products?${qs}`)
    },
  })
}

export function useCreateProduct() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (product: EtmProductInsert) =>
      fetchJson<EtmProduct>('/api/products', jsonInit('POST', product)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PRODUCTS_KEY })
    },
  })
}

export function useUpdateProduct() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: EtmProductUpdate }) =>
      fetchJson<EtmProduct>(`/api/products/${id}`, jsonInit('PATCH', updates)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PRODUCTS_KEY })
    },
  })
}

/**
 * Toggle rápido del tri-estado `is_sold` desde la tabla (issue #55).
 *
 * Optimista: la fila cambia al instante en todas las páginas cacheadas y se
 * revierte al snapshot si el PATCH falla — marcar decenas de productos seguidos
 * no debe esperar al servidor en cada click.
 */
export function useSetProductSold() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, is_sold }: { id: string; is_sold: boolean | null }) =>
      fetchJson<EtmProduct>(`/api/products/${id}`, jsonInit('PATCH', { is_sold })),

    onMutate: async ({ id, is_sold }) => {
      await queryClient.cancelQueries({ queryKey: PRODUCTS_KEY })
      const previous = queryClient.getQueriesData<ProductsResponse>({ queryKey: PRODUCTS_KEY })

      queryClient.setQueriesData<ProductsResponse>({ queryKey: PRODUCTS_KEY }, (old) =>
        old
          ? { ...old, data: old.data.map((p) => (p.id === id ? { ...p, is_sold } : p)) }
          : old,
      )

      return { previous }
    },

    onError: (_err, _vars, context) => {
      context?.previous?.forEach(([key, data]) => queryClient.setQueryData(key, data))
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: PRODUCTS_KEY })
    },
  })
}

export function useDeleteProduct() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) =>
      fetchJson<{ ok: true }>(`/api/products/${id}`, { method: 'DELETE' }),
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
