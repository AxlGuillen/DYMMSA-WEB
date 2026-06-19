'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchJson } from '@/lib/fetch-json'
import type {
  UrreaCatalogItem,
  UrreaCatalogInsert,
  UrreaCatalogUpdate,
} from '@/types/database'

const CATALOG_KEY = ['urrea-catalog']

export type CatalogSortField = 'code' | 'description' | 'price' | 'std'
export type SortDir = 'asc' | 'desc'

interface CatalogParams {
  page?: number
  pageSize?: number
  search?: string
  sortField?: CatalogSortField
  sortDir?: SortDir
}

interface CatalogResponse {
  data: UrreaCatalogItem[]
  count: number
  page: number
  pageSize: number
  totalPages: number
}

export function useUrreaCatalog(params: CatalogParams = {}) {
  const {
    page = 1,
    pageSize = 20,
    search = '',
    sortField = 'description',
    sortDir = 'asc',
  } = params

  return useQuery({
    queryKey: [...CATALOG_KEY, { page, pageSize, search, sortField, sortDir }],
    queryFn: async (): Promise<CatalogResponse> => {
      const qs = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
        sortField,
        sortDir,
      })
      if (search) qs.set('search', search)
      return fetchJson<CatalogResponse>(`/api/urrea-catalog?${qs.toString()}`)
    },
  })
}

export function useUrreaCatalogStats() {
  return useQuery({
    queryKey: [...CATALOG_KEY, 'stats'],
    queryFn: async (): Promise<{ total: number }> =>
      fetchJson<{ total: number }>('/api/urrea-catalog/stats'),
  })
}

export function useCreateCatalogItem() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (item: UrreaCatalogInsert) =>
      fetchJson<UrreaCatalogItem>('/api/urrea-catalog', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(item),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CATALOG_KEY })
    },
  })
}

export function useUpdateCatalogItem() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: UrreaCatalogUpdate }) =>
      fetchJson<UrreaCatalogItem>(`/api/urrea-catalog/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(updates),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CATALOG_KEY })
    },
  })
}

export function useDeleteCatalogItem() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (id: string) =>
      fetchJson<{ ok: true }>(`/api/urrea-catalog/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CATALOG_KEY })
    },
  })
}

export function useImportUrreaCatalog() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (formData: FormData) => {
      const response = await fetch('/api/urrea-catalog/import', {
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
      queryClient.invalidateQueries({ queryKey: CATALOG_KEY })
    },
  })
}
