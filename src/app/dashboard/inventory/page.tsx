'use client'

import { useState } from 'react'
import { useInventory } from '@/hooks/useInventory'
import { InventoryTable } from '@/components/inventory/InventoryTable'
import { InventoryForm } from '@/components/inventory/InventoryForm'
import { InventoryImporter } from '@/components/inventory/InventoryImporter'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Plus, Upload, Search, ChevronLeft, ChevronRight } from 'lucide-react'
import type { StoreInventory } from '@/types/database'

export default function InventoryPage() {
  const [search, setSearch] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [page, setPage] = useState(1)
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [isImportOpen, setIsImportOpen] = useState(false)
  const [editingItem, setEditingItem] = useState<StoreInventory | null>(null)

  const { data, isLoading } = useInventory({
    page,
    pageSize: 20,
    search: searchQuery,
  })

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setSearchQuery(search)
    setPage(1)
  }

  const handleEdit = (item: StoreInventory) => {
    setEditingItem(item)
    setIsFormOpen(true)
  }

  const handleCloseForm = (open: boolean) => {
    setIsFormOpen(open)
    if (!open) {
      setEditingItem(null)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Inventario / Stock</h2>
          <p className="text-muted-foreground">
            Gestiona el inventario de productos URREA en DYMMSA.
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
              placeholder="Buscar por codigo modelo..."
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

      <InventoryTable
        items={data?.data || []}
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

      <InventoryForm
        open={isFormOpen}
        onOpenChange={handleCloseForm}
        item={editingItem}
      />

      <InventoryImporter
        open={isImportOpen}
        onOpenChange={setIsImportOpen}
      />
    </div>
  )
}
