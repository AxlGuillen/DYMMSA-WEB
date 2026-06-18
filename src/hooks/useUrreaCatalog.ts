'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
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
  const supabase = createClient()

  return useQuery({
    queryKey: [...CATALOG_KEY, { page, pageSize, search, sortField, sortDir }],
    queryFn: async (): Promise<CatalogResponse> => {
      let query = supabase.from('urrea_catalog').select('*', { count: 'exact' })

      if (search) {
        query = query.or(`code.ilike.%${search}%,description.ilike.%${search}%`)
      }

      const from = (page - 1) * pageSize
      const to = from + pageSize - 1

      const { data, error, count } = await query
        .order(sortField, { ascending: sortDir === 'asc', nullsFirst: false })
        .range(from, to)
        .limit(5000)

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

export function useUrreaCatalogStats() {
  const supabase = createClient()

  return useQuery({
    queryKey: [...CATALOG_KEY, 'stats'],
    queryFn: async (): Promise<{ total: number }> => {
      const { count, error } = await supabase
        .from('urrea_catalog')
        .select('id', { count: 'exact', head: true })

      if (error) throw error
      return { total: count || 0 }
    },
  })
}

export function useCreateCatalogItem() {
  const queryClient = useQueryClient()
  const supabase = createClient()

  return useMutation({
    mutationFn: async (item: UrreaCatalogInsert) => {
      const { data, error } = await supabase
        .from('urrea_catalog')
        .insert(item)
        .select()
        .single()

      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CATALOG_KEY })
    },
  })
}

export function useUpdateCatalogItem() {
  const queryClient = useQueryClient()
  const supabase = createClient()

  return useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: UrreaCatalogUpdate }) => {
      const { data, error } = await supabase
        .from('urrea_catalog')
        .update(updates)
        .eq('id', id)
        .select()
        .single()

      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CATALOG_KEY })
    },
  })
}

export function useDeleteCatalogItem() {
  const queryClient = useQueryClient()
  const supabase = createClient()

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('urrea_catalog').delete().eq('id', id)
      if (error) throw error
    },
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
