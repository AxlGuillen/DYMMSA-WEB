'use client'

import { useState } from 'react'
import { useInventory, useInventoryStats } from '@/hooks/useInventory'
import type { StockFilter, QuantitySort } from '@/hooks/useInventory'
import { InventoryTable } from '@/components/inventory/InventoryTable'
import { InventoryForm } from '@/components/inventory/InventoryForm'
import { InventoryImporter } from '@/components/inventory/InventoryImporter'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Plus, Upload, Search, X, ChevronLeft, ChevronRight, ListFilter } from 'lucide-react'
import type { StoreInventory } from '@/types/database'

const STAT_CARDS: {
  key: StockFilter
  label: string
  dot: string
  color: string
  bg: string
  ring: string
}[] = [
  { key: 'all',       label: 'Total',      dot: 'bg-slate-500',  color: 'text-slate-700 dark:text-slate-300',   bg: 'bg-slate-50 hover:bg-slate-100 dark:bg-slate-900/30 dark:hover:bg-slate-800/50',     ring: 'ring-slate-400'  },
  { key: 'in_stock',  label: 'En stock',   dot: 'bg-green-500',  color: 'text-green-700 dark:text-green-300',   bg: 'bg-green-50 hover:bg-green-100 dark:bg-green-900/30 dark:hover:bg-green-900/50',     ring: 'ring-green-400'  },
  { key: 'low_stock', label: 'Stock bajo', dot: 'bg-yellow-500', color: 'text-yellow-700 dark:text-yellow-300', bg: 'bg-yellow-50 hover:bg-yellow-100 dark:bg-yellow-900/30 dark:hover:bg-yellow-900/50', ring: 'ring-yellow-400' },
  { key: 'sin_stock', label: 'Sin stock',  dot: 'bg-red-500',    color: 'text-red-700 dark:text-red-300',       bg: 'bg-red-50 hover:bg-red-100 dark:bg-red-900/30 dark:hover:bg-red-900/50',             ring: 'ring-red-400'    },
]

const STATS_KEY_MAP: Record<StockFilter, 'total' | 'in_stock' | 'low_stock' | 'sin_stock'> = {
  all:       'total',
  in_stock:  'in_stock',
  low_stock: 'low_stock',
  sin_stock: 'sin_stock',
}

// oxlint-disable-next-line react-doctor/prefer-useReducer -- intentional pattern; structural refactor tracked separately
export default function InventoryPage() {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [stockFilter, setStockFilter] = useState<StockFilter>('all')
  const [quantitySort, setQuantitySort] = useState<QuantitySort>(null)
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [isImportOpen, setIsImportOpen] = useState(false)
  const [editingItem, setEditingItem] = useState<StoreInventory | null>(null)

  const { data, isLoading } = useInventory({ page, pageSize: 20, search, stockFilter, quantitySort })
  const { data: stats } = useInventoryStats()

  const handleEdit = (item: StoreInventory) => {
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
          <h1 className="text-3xl font-semibold tracking-tight">Inventario</h1>
          <p className="text-muted-foreground">
            Gestiona el stock de productos en la tienda DYMMSA.
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

      {/* Stats cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {STAT_CARDS.map((card) => {
          const isActive = stockFilter === card.key
          return (
            <button type="button"
              key={card.key}
              onClick={() => {
                setStockFilter((s) => (s === card.key && card.key !== 'all') ? 'all' : card.key)
                setPage(1)
              }}
              title={isActive && card.key !== 'all' ? `Quitar filtro: ${card.label}` : `Filtrar por ${card.label}`}
              className={`group rounded-lg border p-4 text-left transition-colors cursor-pointer ${card.bg} ${
                isActive ? `ring-2 ring-offset-1 ${card.ring}` : ''
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className={`inline-block h-2 w-2 rounded-full shrink-0 ${card.dot}`} />
                  <span className={`text-xs font-medium ${card.color}`}>{card.label}</span>
                </div>
                <ListFilter className={`h-3 w-3 shrink-0 transition-opacity ${
                  isActive
                    ? `opacity-60 ${card.color}`
                    : 'opacity-0 group-hover:opacity-35 text-muted-foreground'
                }`} />
              </div>
              <p className={`text-2xl font-bold ${card.color}`}>
                {stats ? stats[STATS_KEY_MAP[card.key]] : '—'}
              </p>
            </button>
          )
        })}
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Buscar por código modelo..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1) }}
          className="pl-10 pr-9"
        />
        {search && (
          <button type="button"
            onClick={() => { setSearch(''); setPage(1) }}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="size-4" />
          </button>
        )}
      </div>

      {/* Table */}
      <InventoryTable
        items={data?.data || []}
        isLoading={isLoading}
        onEdit={handleEdit}
        onAdd={() => setIsFormOpen(true)}
        quantitySort={quantitySort}
        onSortQuantity={() => {
          setQuantitySort((s) => s === 'desc' ? 'asc' : 'desc')
          setPage(1)
        }}
      />

      {/* Pagination */}
      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Mostrando{' '}
            {(page - 1) * data.pageSize + 1}–
            {Math.min(page * data.pageSize, data.count)} de {data.count} productos
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
            >
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
