'use client'

import { useState } from 'react'
import { useProducts } from '@/hooks/useProducts'
import { ProductsTable } from '@/components/db/ProductsTable'
import { ProductForm } from '@/components/db/ProductForm'
import { ExcelImporter } from '@/components/db/ExcelImporter'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Plus, Upload, Search, ChevronLeft, ChevronRight } from 'lucide-react'
import type { EtmProduct } from '@/types/database'

export default function ProductosPage() {
  const [search, setSearch] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [page, setPage] = useState(1)
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [isImportOpen, setIsImportOpen] = useState(false)
  const [editingProduct, setEditingProduct] = useState<EtmProduct | null>(null)

  const { data, isLoading } = useProducts({
    page,
    pageSize: 20,
    search: searchQuery,
  })

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setSearchQuery(search)
    setPage(1)
  }

  const handleEdit = (product: EtmProduct) => {
    setEditingProduct(product)
    setIsFormOpen(true)
  }

  const handleCloseForm = (open: boolean) => {
    setIsFormOpen(open)
    if (!open) {
      setEditingProduct(null)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Catalogo de Productos</h2>
          <p className="text-muted-foreground">
            Gestiona el catalogo ETM - URREA
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

      <div className="flex items-center justify-between gap-4">
        <form onSubmit={handleSearch} className="flex gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar por ETM, modelo o descripcion..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-[300px] pl-9"
            />
          </div>
          <Button type="submit" variant="secondary">
            Buscar
          </Button>
          {searchQuery && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setSearch('')
                setSearchQuery('')
                setPage(1)
              }}
            >
              Limpiar
            </Button>
          )}
        </form>

        {data && (
          <Badge variant="secondary">
            {data.count} productos
          </Badge>
        )}
      </div>

      <ProductsTable
        products={data?.data || []}
        isLoading={isLoading}
        onEdit={handleEdit}
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
            Pagina {page} de {data.totalPages}
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
