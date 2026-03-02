'use client'

import { useState } from 'react'
import { Plus, Pencil, Trash2, AlertTriangle, AlertCircle, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ProductModal } from './ProductModal'
import { useQuotationStore } from '@/stores/quotationStore'
import type { QuotationItemRow } from '@/types/database'

// --- helpers ----------------------------------------------------------

/** Naranja: ETM existe pero sin descripción ni código modelo */
const isMissingData = (item: QuotationItemRow): boolean =>
  !item.description && !item.model_code

/** Amarillo: tiene algún dato pero le falta la cantidad */
const isMissingQuantity = (item: QuotationItemRow): boolean =>
  !isMissingData(item) && item.quantity == null

/** Verde/normal: tiene cantidad y precio */
const isComplete = (item: QuotationItemRow): boolean =>
  item.quantity != null && item.unit_price != null

const getRowClass = (item: QuotationItemRow): string => {
  if (isMissingData(item))
    return 'bg-orange-50 dark:bg-orange-950/20 hover:bg-orange-100 dark:hover:bg-orange-950/30'
  if (isMissingQuantity(item))
    return 'bg-yellow-50 dark:bg-yellow-950/20 hover:bg-yellow-100 dark:hover:bg-yellow-950/30'
  if (isComplete(item))
    return 'bg-green-50 dark:bg-green-950/20 hover:bg-green-100 dark:hover:bg-green-950/30'
  return 'bg-background hover:bg-muted/40'
}

// --- component --------------------------------------------------------

export function QuotationEditor() {
  const { items, addItem, updateItem, removeItem } = useQuotationStore()

  const [modalOpen, setModalOpen]       = useState(false)
  const [modalMode, setModalMode]       = useState<'edit' | 'create'>('create')
  const [selectedItem, setSelectedItem] = useState<QuotationItemRow | undefined>()

  const handleEdit = (item: QuotationItemRow) => {
    setSelectedItem(item)
    setModalMode('edit')
    setModalOpen(true)
  }

  const handleCreate = () => {
    setSelectedItem(undefined)
    setModalMode('create')
    setModalOpen(true)
  }

  const handleModalSave = (data: Omit<QuotationItemRow, '_id'>, id?: string) => {
    if (id) {
      updateItem(id, data)
    } else {
      addItem(data)
    }
  }

  // --- stats ---
  const noDataCount     = items.filter(isMissingData).length
  const noQuantityCount = items.filter(isMissingQuantity).length
  const completeCount   = items.filter(isComplete).length

  const partialTotal = items.reduce((sum, item) => {
    if (item.unit_price != null && item.quantity != null) {
      return sum + item.unit_price * item.quantity
    }
    return sum
  }, 0)

  const allComplete = items.length > 0 && noDataCount === 0 && noQuantityCount === 0

  return (
    <div className="space-y-4">

      {/* Summary cards */}
      {items.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {/* Total */}
          <div className="rounded-lg border bg-card px-4 py-3 space-y-0.5">
            <p className="text-xs text-muted-foreground">Total productos</p>
            <p className="text-xl font-bold">{items.length}</p>
          </div>

          {/* Completos */}
          <div className="rounded-lg border bg-card px-4 py-3 space-y-0.5">
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3 text-green-500" />
              Completos
            </p>
            <p className="text-xl font-bold text-green-600 dark:text-green-400">
              {completeCount}
            </p>
          </div>

          {/* Sin cantidad */}
          <div className={`rounded-lg border px-4 py-3 space-y-0.5 ${
            noQuantityCount > 0
              ? 'bg-yellow-50 dark:bg-yellow-950/20 border-yellow-200 dark:border-yellow-800'
              : 'bg-card'
          }`}>
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <AlertTriangle className="h-3 w-3 text-yellow-500" />
              Sin cantidad
            </p>
            <p className={`text-xl font-bold ${
              noQuantityCount > 0 ? 'text-yellow-600 dark:text-yellow-400' : 'text-muted-foreground'
            }`}>
              {noQuantityCount}
            </p>
          </div>

          {/* Sin datos */}
          <div className={`rounded-lg border px-4 py-3 space-y-0.5 ${
            noDataCount > 0
              ? 'bg-orange-50 dark:bg-orange-950/20 border-orange-200 dark:border-orange-800'
              : 'bg-card'
          }`}>
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <AlertCircle className="h-3 w-3 text-orange-500" />
              Sin datos
            </p>
            <p className={`text-xl font-bold ${
              noDataCount > 0 ? 'text-orange-600 dark:text-orange-400' : 'text-muted-foreground'
            }`}>
              {noDataCount}
            </p>
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 text-sm">
          {partialTotal > 0 && (
            <span className="font-medium">
              {allComplete ? 'Total:' : 'Total parcial:'}
              {' '}
              <span className="text-foreground">
                ${partialTotal.toLocaleString('es-MX', { minimumFractionDigits: 2 })}
              </span>
              {!allComplete && (
                <span className="text-muted-foreground text-xs ml-1">
                  (faltan cantidades)
                </span>
              )}
            </span>
          )}
        </div>
        <Button size="sm" onClick={handleCreate}>
          <Plus className="h-4 w-4 mr-1.5" />
          Agregar producto
        </Button>
      </div>

      {/* Table */}
      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center text-muted-foreground">
          <p className="text-sm">
            No hay productos. Carga un Excel o agrega uno manualmente.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {/* Legend */}
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 rounded-sm bg-orange-200 dark:bg-orange-800" />
              Sin datos
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 rounded-sm bg-yellow-200 dark:bg-yellow-800" />
              Sin cantidad
            </span>
          </div>

          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">ETM</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Descripción</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Código</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Marca</th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground">Precio unit.</th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground">Cant.</th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground">Subtotal</th>
                  <th className="px-4 py-3 text-center font-medium text-muted-foreground">Origen</th>
                  <th className="px-4 py-3 text-center font-medium text-muted-foreground">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item._id} className={`border-b border-border/60 ${getRowClass(item)}`}>
                    <td className="px-4 py-3 font-mono text-xs font-medium">
                      {item.etm}
                    </td>
                    <td className="px-4 py-3 max-w-52">
                      {item.description ? (
                        <span className="truncate block" title={item.description}>
                          {item.description}
                        </span>
                      ) : (
                        <span className="text-muted-foreground italic text-xs">Sin descripción</span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">
                      {item.model_code || <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      {item.brand || <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {item.unit_price != null ? (
                        `$${item.unit_price.toLocaleString('es-MX', { minimumFractionDigits: 2 })}`
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {item.quantity != null ? (
                        item.quantity
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {item.unit_price != null && item.quantity != null ? (
                        <span className="font-medium">
                          ${(item.unit_price * item.quantity).toLocaleString('es-MX', { minimumFractionDigits: 2 })}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {item._inDb ? (
                        <Badge variant="secondary" className="text-xs">
                          Catálogo
                        </Badge>
                      ) : (
                        <Badge
                          variant="outline"
                          className="text-xs text-amber-600 border-amber-300"
                        >
                          Nuevo
                        </Badge>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          onClick={() => handleEdit(item)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          <span className="sr-only">Editar</span>
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                          onClick={() => removeItem(item._id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          <span className="sr-only">Eliminar</span>
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <ProductModal
        mode={modalMode}
        item={selectedItem}
        open={modalOpen}
        onOpenChange={setModalOpen}
        onSave={handleModalSave}
      />
    </div>
  )
}
