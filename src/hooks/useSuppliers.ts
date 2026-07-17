'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchJson } from '@/lib/fetch-json'
import type {
  Brand,
  BrandWithCount,
  Supplier,
  SupplierInsert,
  SupplierUpdate,
  SupplierWithBrands,
} from '@/types/database'

export const SUPPLIERS_KEY = ['suppliers']
export const BRANDS_KEY = ['brands']

// ─── Proveedores ────────────────────────────────────────────────────────

export type SupplierSortField = 'name' | 'updated_at'

interface SuppliersParams {
  page?: number
  pageSize?: number
  search?: string
  brandId?: string
  sortField?: SupplierSortField
  sortDir?: 'asc' | 'desc'
}

interface SuppliersResponse {
  data: SupplierWithBrands[]
  count: number
  page: number
  pageSize: number
  totalPages: number
}

export function useSuppliers(params: SuppliersParams = {}) {
  const {
    page = 1, pageSize = 20, search = '', brandId = '',
    sortField = 'name', sortDir = 'asc',
  } = params

  return useQuery({
    queryKey: [...SUPPLIERS_KEY, { page, pageSize, search, brandId, sortField, sortDir }],
    queryFn: async (): Promise<SuppliersResponse> => {
      const qs = new URLSearchParams({
        page: String(page), pageSize: String(pageSize), sortField, sortDir,
      })
      if (search) qs.set('search', search)
      if (brandId) qs.set('brandId', brandId)
      return fetchJson<SuppliersResponse>(`/api/suppliers?${qs.toString()}`)
    },
  })
}

export interface CreateSupplierInput extends SupplierInsert {
  brandIds?: string[]
}

export function useCreateSupplier() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: CreateSupplierInput) =>
      fetchJson<Supplier>('/api/suppliers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SUPPLIERS_KEY })
      // Los conteos de uso de marcas cambian al asignar.
      queryClient.invalidateQueries({ queryKey: BRANDS_KEY })
    },
  })
}

export interface UpdateSupplierInput {
  id: string
  updates: SupplierUpdate & { brandIds?: string[] }
}

export function useUpdateSupplier() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, updates }: UpdateSupplierInput) =>
      fetchJson<{ ok: boolean }>(`/api/suppliers/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(updates),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SUPPLIERS_KEY })
      queryClient.invalidateQueries({ queryKey: BRANDS_KEY })
    },
  })
}

export function useDeleteSupplier() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) =>
      fetchJson<{ ok: boolean }>(`/api/suppliers/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SUPPLIERS_KEY })
      queryClient.invalidateQueries({ queryKey: BRANDS_KEY })
    },
  })
}

// ─── Marcas (submódulo) ─────────────────────────────────────────────────

export function useBrands() {
  return useQuery({
    queryKey: BRANDS_KEY,
    queryFn: async (): Promise<BrandWithCount[]> => {
      const { brands } = await fetchJson<{ brands: BrandWithCount[] }>('/api/brands')
      return brands
    },
  })
}

export function useCreateBrand() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (name: string) =>
      fetchJson<Brand>('/api/brands', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: BRANDS_KEY }),
  })
}

export function useUpdateBrand() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) =>
      fetchJson<{ ok: boolean }>(`/api/brands/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: BRANDS_KEY })
      // El rename se refleja en las etiquetas de las filas de proveedores.
      queryClient.invalidateQueries({ queryKey: SUPPLIERS_KEY })
    },
  })
}

export function useDeleteBrand() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) =>
      fetchJson<{ ok: boolean }>(`/api/brands/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: BRANDS_KEY })
      queryClient.invalidateQueries({ queryKey: SUPPLIERS_KEY })
    },
  })
}
