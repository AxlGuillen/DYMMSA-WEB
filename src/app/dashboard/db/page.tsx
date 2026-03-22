'use client'

import { useState, useEffect, useRef } from 'react'
import { useProducts } from '@/hooks/useProducts'
import type { ProductSortBy, SortDir } from '@/hooks/useProducts'
import { ProductsTable } from '@/components/db/ProductsTable'
import { ProductForm } from '@/components/db/ProductForm'
import { ExcelImporter } from '@/components/db/ExcelImporter'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Plus, Upload, Search, ChevronLeft, ChevronRight, X, Database } from 'lucide-react'
import type { EtmProduct } from '@/types/database'

const PAGE_SIZE = 20

export default function ProductosPage() {
  const [search, setSearch] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [page, setPage] = useState(1)
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [isImportOpen, setIsImportOpen] = useState(false)
  const [editingProduct, setEditingProduct] = useState<EtmProduct | null>(null)
  const [sortBy, setSortBy] = useState<ProductSortBy>('etm')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const { data, isLoading } = useProducts({
    page,
    pageSize: PAGE_SIZE,
    search: searchQuery,
    sortBy,
    sortDir,
  })

  const handleSort = (col: ProductSortBy) => {
    if (col === sortBy) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortBy(col)
      setSortDir('asc')
    }
    setPage(1)
  }

  // Debounced live search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setSearchQuery(search)
      setPage(1)
    }, 350)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [search])

  const handleEdit = (product: EtmProduct) => {
    setEditingProduct(product)
    setIsFormOpen(true)
  }

  const handleCloseForm = (open: boolean) => {
    setIsFormOpen(open)
    if (!open) setEditingProduct(null)
  }

  const rangeStart = data ? (page - 1) * PAGE_SIZE + 1 : 0
  const rangeEnd = data ? Math.min(page * PAGE_SIZE, data.count) : 0

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">ETM - URREA</h2>
          <p className="text-muted-foreground">
            Gestiona los productos ETM - URREA disponibles para cotizaciones.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setIsImportOpen(true)}>
            <Upload className="mr-2 h-4 w-4" />
            Importar Excel
          </Button>
          <Button onClick={() => setIsFormOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Agregar Producto
          </Button>
        </div>
      </div>

      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por ETM, modelo o descripcion..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-[320px] pl-9 pr-9"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {data && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Database className="h-4 w-4" />
            <span>
              {data.count > 0
                ? <>Mostrando <span className="font-medium text-foreground">{rangeStart}–{rangeEnd}</span> de <span className="font-medium text-foreground">{data.count}</span> productos</>
                : 'Sin resultados'
              }
            </span>
            {searchQuery && (
              <Badge variant="secondary" className="ml-1">
                {searchQuery}
              </Badge>
            )}
          </div>
        )}
      </div>

      <ProductsTable
        products={data?.data || []}
        isLoading={isLoading}
        onEdit={handleEdit}
        sortBy={sortBy}
        sortDir={sortDir}
        onSort={handleSort}
      />

      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
          >
            <ChevronLeft className="h-4 w-4" />
            Anterior
          </Button>
          <span className="text-sm text-muted-foreground">
            Página <span className="font-medium text-foreground">{page}</span> de <span className="font-medium text-foreground">{data.totalPages}</span>
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))}
            disabled={page === data.totalPages}
          >
            Siguiente
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}

      <ProductForm
        open={isFormOpen}
        onOpenChange={handleCloseForm}
        product={editingProduct}
      />

      <ExcelImporter
        open={isImportOpen}
        onOpenChange={setIsImportOpen}
      />
    </div>
  )
}
