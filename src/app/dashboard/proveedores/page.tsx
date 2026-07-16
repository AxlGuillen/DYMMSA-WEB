'use client'

import { useState } from 'react'
import { useSuppliers, useBrands, type SupplierSortField } from '@/hooks/useSuppliers'
import { SuppliersTable, SUPPLIERS_COLUMNS } from '@/components/suppliers/SuppliersTable'
import { SupplierForm } from '@/components/suppliers/SupplierForm'
import { BrandsManager } from '@/components/suppliers/BrandsManager'
import { ColumnPicker } from '@/components/ColumnPicker'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Plus, Search, X, ChevronLeft, ChevronRight, ListFilter } from '@/components/icons'
import type { SupplierWithBrands } from '@/types/database'

const ALL_BRANDS = '__all__'

export default function SuppliersPage() {
  const [search, setSearch] = useState('')
  const [brandId, setBrandId] = useState<string>(ALL_BRANDS)
  const [page, setPage] = useState(1)
  const [sortField, setSortField] = useState<SupplierSortField>('name')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [isBrandsOpen, setIsBrandsOpen] = useState(false)
  const [editingSupplier, setEditingSupplier] = useState<SupplierWithBrands | null>(null)

  const { data, isLoading } = useSuppliers({
    page,
    pageSize: 20,
    search,
    brandId: brandId === ALL_BRANDS ? '' : brandId,
    sortField,
    sortDir,
  })
  const { data: brands = [] } = useBrands()

  const handleSort = (field: SupplierSortField) => {
    if (field === sortField) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortDir('asc')
    }
    setPage(1)
  }

  const handleEdit = (supplier: SupplierWithBrands) => {
    setEditingSupplier(supplier)
    setIsFormOpen(true)
  }

  const handleCloseForm = (open: boolean) => {
    setIsFormOpen(open)
    if (!open) setEditingSupplier(null)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Proveedores</h1>
          <p className="text-muted-foreground">
            Proveedores de menudeo: contacto y marcas que maneja cada uno.
            {data ? ` · ${data.count} proveedor${data.count !== 1 ? 'es' : ''}` : ''}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setIsBrandsOpen(true)}>
            <ListFilter className="mr-2 size-4" />
            Marcas
          </Button>
          <Button onClick={() => setIsFormOpen(true)}>
            <Plus className="mr-2 size-4" />
            Agregar proveedor
          </Button>
        </div>
      </div>

      {/* Search + brand filter */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por nombre, teléfono o correo..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1) }}
            className="pl-10 pr-9"
          />
          {search && (
            <button
              type="button"
              onClick={() => { setSearch(''); setPage(1) }}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          )}
        </div>
        <Select value={brandId} onValueChange={(v) => { setBrandId(v); setPage(1) }}>
          <SelectTrigger className="w-full sm:w-[220px]">
            <SelectValue placeholder="Todas las marcas" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_BRANDS}>Todas las marcas</SelectItem>
            {brands.map((brand) => (
              <SelectItem key={brand.id} value={brand.id}>
                {brand.name} ({brand.suppliersCount})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <ColumnPicker tableId="suppliers" columns={SUPPLIERS_COLUMNS} />
      </div>

      {/* Table */}
      <SuppliersTable
        suppliers={data?.data || []}
        isLoading={isLoading}
        onEdit={handleEdit}
        onAdd={() => setIsFormOpen(true)}
        sortField={sortField}
        sortDir={sortDir}
        onSort={handleSort}
      />

      {/* Pagination */}
      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Mostrando {(page - 1) * data.pageSize + 1}–
            {Math.min(page * data.pageSize, data.count)} de {data.count} proveedores
          </p>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>
              <ChevronLeft className="size-4" />
              Anterior
            </Button>
            <span className="px-1 text-sm text-muted-foreground">
              {page} / {data.totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))}
              disabled={page === data.totalPages}
            >
              Siguiente
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      )}

      <SupplierForm open={isFormOpen} onOpenChange={handleCloseForm} supplier={editingSupplier} />
      <BrandsManager open={isBrandsOpen} onOpenChange={setIsBrandsOpen} />
    </div>
  )
}
