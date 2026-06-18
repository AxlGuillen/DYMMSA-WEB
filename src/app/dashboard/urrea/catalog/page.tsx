'use client'

import { useState } from 'react'
import { useUrreaCatalog, useUrreaCatalogStats } from '@/hooks/useUrreaCatalog'
import type { CatalogSortField, SortDir } from '@/hooks/useUrreaCatalog'
import { CatalogTable } from '@/components/urrea-catalog/CatalogTable'
import { CatalogForm } from '@/components/urrea-catalog/CatalogForm'
import { CatalogImporter } from '@/components/urrea-catalog/CatalogImporter'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Plus, Upload, Search, X, ChevronLeft, ChevronRight } from 'lucide-react'
import type { UrreaCatalogItem } from '@/types/database'

export default function UrreaCatalogPage() {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [sortField, setSortField] = useState<CatalogSortField>('description')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [isImportOpen, setIsImportOpen] = useState(false)
  const [editingItem, setEditingItem] = useState<UrreaCatalogItem | null>(null)

  const { data, isLoading } = useUrreaCatalog({ page, pageSize: 20, search, sortField, sortDir })
  const { data: stats } = useUrreaCatalogStats()

  const handleSort = (field: CatalogSortField) => {
    if (field === sortField) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortDir('asc')
    }
    setPage(1)
  }

  const handleEdit = (item: UrreaCatalogItem) => {
    setEditingItem(item)
    setIsFormOpen(true)
  }

  const handleCloseForm = (open: boolean) => {
    setIsFormOpen(open)
    if (!open) setEditingItem(null)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Catálogo URREA</h1>
          <p className="text-muted-foreground">
            Catálogo de productos URREA: código, descripción, STD y precio de catálogo.
            {stats ? ` · ${stats.total} producto${stats.total !== 1 ? 's' : ''}` : ''}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setIsImportOpen(true)}>
            <Upload className="mr-2 size-4" />
            Importar Excel
          </Button>
          <Button onClick={() => setIsFormOpen(true)}>
            <Plus className="mr-2 size-4" />
            Agregar Producto
          </Button>
        </div>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Buscar por código o descripción..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1) }}
          className="pl-10 pr-9"
        />
        {search && (
          <button
            type="button"
            onClick={() => { setSearch(''); setPage(1) }}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="size-4" />
          </button>
        )}
      </div>

      {/* Table */}
      <CatalogTable
        items={data?.data || []}
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
            {Math.min(page * data.pageSize, data.count)} de {data.count} productos
          </p>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>
              <ChevronLeft className="size-4" />
              Anterior
            </Button>
            <span className="text-sm text-muted-foreground px-1">
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

      <CatalogForm open={isFormOpen} onOpenChange={handleCloseForm} item={editingItem} />
      <CatalogImporter open={isImportOpen} onOpenChange={setIsImportOpen} />
    </div>
  )
}
