'use client'

import { useState } from 'react'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Plus, Pencil, Trash2, AlertTriangle, AlertCircle, CheckCircle2, GripVertical, SeparatorHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { ProductModal } from './ProductModal'
import { DELIVERY_TIME_LABELS } from '@/lib/delivery'
import { useQuotationStore } from '@/stores/quotationStore'
import { useCurrency } from '@/hooks/useCurrency'
import { calculateQuotationTotal, isProductItem } from '@/lib/business-rules'
import type { QuotationItemRow } from '@/types/database'

// --- helpers ----------------------------------------------------------

const isMissingData = (item: QuotationItemRow): boolean =>
  isProductItem(item) && !item.description && !item.model_code

const hasNoModelCode = (item: QuotationItemRow): boolean =>
  !isMissingData(item) && !item.model_code

const isMissingQuantity = (item: QuotationItemRow): boolean =>
  !isMissingData(item) && !hasNoModelCode(item) && item.quantity == null

const isComplete = (item: QuotationItemRow): boolean =>
  !!item.model_code && item.quantity != null && item.unit_price != null

const getRowClass = (item: QuotationItemRow): string => {
  if (isMissingData(item))
    return 'bg-orange-50 dark:bg-orange-950/20 hover:bg-orange-100 dark:hover:bg-orange-950/30'
  if (hasNoModelCode(item))
    return 'bg-muted/40 dark:bg-muted/20 hover:bg-muted/60 dark:hover:bg-muted/30'
  if (isMissingQuantity(item))
    return 'bg-yellow-50 dark:bg-yellow-950/20 hover:bg-yellow-100 dark:hover:bg-yellow-950/30'
  if (isComplete(item))
    return 'bg-green-50 dark:bg-green-950/20 hover:bg-green-100 dark:hover:bg-green-950/30'
  return 'bg-background hover:bg-muted/40'
}

// --- sortable separator row -------------------------------------------

interface SortableSeparatorRowProps {
  item: QuotationItemRow
  onLabelChange: (id: string, label: string) => void
  onRemove: (id: string) => void
  colSpan: number
}

function SortableSeparatorRow({ item, onLabelChange, onRemove, colSpan }: SortableSeparatorRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: item._id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  }

  return (
    <tr
      ref={setNodeRef}
      style={style}
      className={`border-b border-dashed border-border/60 bg-muted/30 ${isDragging ? 'shadow-lg' : ''}`}
    >
      <td className="p-2  w-8">
        <button type="button"
          {...attributes}
          {...listeners}
          className="cursor-grab active:cursor-grabbing text-muted-foreground/40 hover:text-muted-foreground transition-colors touch-none"
          aria-label="Arrastrar separador"
        >
          <GripVertical className="size-4" />
        </button>
      </td>
      <td colSpan={colSpan - 2} className="px-4 py-2">
        <div className="flex items-center gap-2">
          <SeparatorHorizontal className="size-3.5 text-muted-foreground shrink-0" />
          <Input
            value={item.section_label ?? ''}
            onChange={(e) => onLabelChange(item._id, e.target.value)}
            placeholder="Nombre de la sección (opcional)..."
            className="h-7 text-xs bg-transparent border-dashed focus-visible:border-solid"
          />
        </div>
      </td>
      <td className="px-4 py-2 text-center">
        <Button
          size="icon" variant="ghost"
          className="size-7 text-destructive hover:text-destructive hover:bg-destructive/10"
          onClick={() => onRemove(item._id)}
        >
          <Trash2 className="size-3.5" />
          <span className="sr-only">Eliminar separador</span>
        </Button>
      </td>
    </tr>
  )
}

// --- sortable row -----------------------------------------------------

interface SortableRowProps {
  item: QuotationItemRow
  onEdit: (item: QuotationItemRow) => void
  onRemove: (id: string) => void
  onAddSeparatorAfter: (id: string) => void
}

function SortableRow({ item, onEdit, onRemove, onAddSeparatorAfter }: SortableRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: item._id })
  const fmt = useCurrency()

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <tr
      ref={setNodeRef}
      style={style}
      className={`border-b border-border/60 ${getRowClass(item)} ${isDragging ? 'shadow-lg' : ''}`}
    >
      <td className="px-2 py-3 w-8">
        <button type="button"
          {...attributes}
          {...listeners}
          className="cursor-grab active:cursor-grabbing text-muted-foreground/40 hover:text-muted-foreground transition-colors touch-none"
          aria-label="Arrastrar para reordenar"
        >
          <GripVertical className="size-4" />
        </button>
      </td>
      <td className="px-4 py-3 font-mono text-xs font-medium">{item.etm}</td>
      <td className="px-4 py-3 max-w-52">
        {item.description ? (
          <span className="truncate block" title={item.description}>{item.description}</span>
        ) : (
          <span className="text-muted-foreground italic text-xs">Sin descripción</span>
        )}
      </td>
      <td className="px-4 py-3 font-mono text-xs">
        {item.model_code || <span className="text-muted-foreground">{'\u2014'}</span>}
      </td>
      <td className="px-4 py-3">
        {item.brand || <span className="text-muted-foreground">{'\u2014'}</span>}
      </td>
      <td className="px-4 py-3 text-right tabular-nums">
        {item.unit_price != null
          ? fmt(item.unit_price)
          : <span className="text-muted-foreground">{'\u2014'}</span>}
      </td>
      <td className="px-4 py-3 text-right tabular-nums">
        {item.quantity != null ? item.quantity : <span className="text-muted-foreground">{'\u2014'}</span>}
      </td>
      <td className="px-4 py-3 text-right tabular-nums">
        {item.unit_price != null && item.quantity != null ? (
          <span className="font-medium">
            {fmt(item.unit_price * item.quantity)}
          </span>
        ) : (
          <span className="text-muted-foreground">{'\u2014'}</span>
        )}
      </td>
      <td className="px-4 py-3 text-sm text-muted-foreground whitespace-nowrap">
        {DELIVERY_TIME_LABELS[item.delivery_time] ?? '—'}
      </td>
      <td className="px-4 py-3 text-center">
        {item._inDb ? (
          <Badge variant="secondary" className="text-xs">Catálogo</Badge>
        ) : (
          <Badge variant="outline" className="text-xs text-amber-600 border-amber-300">Nuevo</Badge>
        )}
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center justify-center gap-1">
          <Button
            size="icon" variant="ghost"
            className="size-7 text-muted-foreground hover:text-foreground"
            title="Insertar separador debajo"
            onClick={() => onAddSeparatorAfter(item._id)}
          >
            <SeparatorHorizontal className="size-3.5" />
            <span className="sr-only">Insertar separador</span>
          </Button>
          <Button size="icon" variant="ghost" className="size-7" onClick={() => onEdit(item)}>
            <Pencil className="size-3.5" />
            <span className="sr-only">Editar</span>
          </Button>
          <Button
            size="icon" variant="ghost"
            className="size-7 text-destructive hover:text-destructive hover:bg-destructive/10"
            onClick={() => onRemove(item._id)}
          >
            <Trash2 className="size-3.5" />
            <span className="sr-only">Eliminar</span>
          </Button>
        </div>
      </td>
    </tr>
  )
}

// --- component --------------------------------------------------------

export function QuotationEditor() {
  const { items, addItem, updateItem, addSeparatorAfter, removeItem, reorderItems } = useQuotationStore()
  const fmt = useCurrency()
  const productItems = items.filter(isProductItem)

  const [modalOpen, setModalOpen]       = useState(false)
  const [modalMode, setModalMode]       = useState<'edit' | 'create'>('create')
  const [selectedItem, setSelectedItem] = useState<QuotationItemRow | undefined>()

  const sensors = useSensors(useSensor(PointerSensor))

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

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (over && active.id !== over.id) {
      reorderItems(String(active.id), String(over.id))
    }
  }

  // --- stats (only product rows) ---
  const noDataCount     = productItems.filter(isMissingData).length
  const noQuantityCount = productItems.filter(isMissingQuantity).length
  const completeCount   = productItems.filter(isComplete).length

  const partialTotal = calculateQuotationTotal(productItems)

  const allComplete = productItems.length > 0 && noDataCount === 0 && noQuantityCount === 0

  return (
    <div className="space-y-4">

      {/* Summary cards */}
      {items.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="rounded-lg border bg-card px-4 py-3 space-y-0.5">
            <p className="text-xs text-muted-foreground">Total productos</p>
            <p className="text-xl font-bold">{productItems.length}</p>
          </div>
          <div className="rounded-lg border bg-card px-4 py-3 space-y-0.5">
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <CheckCircle2 className="size-3 text-green-500" /> Completos
            </p>
            <p className="text-xl font-bold text-green-600 dark:text-green-400">{completeCount}</p>
          </div>
          <div className={`rounded-lg border px-4 py-3 space-y-0.5 ${
            noQuantityCount > 0
              ? 'bg-yellow-50 dark:bg-yellow-950/20 border-yellow-200 dark:border-yellow-800'
              : 'bg-card'
          }`}>
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <AlertTriangle className="size-3 text-yellow-500" /> Sin cantidad
            </p>
            <p className={`text-xl font-bold ${
              noQuantityCount > 0 ? 'text-yellow-600 dark:text-yellow-400' : 'text-muted-foreground'
            }`}>{noQuantityCount}</p>
          </div>
          <div className={`rounded-lg border px-4 py-3 space-y-0.5 ${
            noDataCount > 0
              ? 'bg-orange-50 dark:bg-orange-950/20 border-orange-200 dark:border-orange-800'
              : 'bg-card'
          }`}>
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <AlertCircle className="size-3 text-orange-500" /> Sin datos
            </p>
            <p className={`text-xl font-bold ${
              noDataCount > 0 ? 'text-orange-600 dark:text-orange-400' : 'text-muted-foreground'
            }`}>{noDataCount}</p>
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 text-sm">
          {partialTotal > 0 && (
            <span className="font-medium">
              {allComplete ? 'Total:' : 'Total parcial:'}{' '}
              <span className="text-foreground">
                {fmt(partialTotal)}
              </span>
              {!allComplete && (
                <span className="text-muted-foreground text-xs ml-1">(faltan cantidades)</span>
              )}
            </span>
          )}
        </div>
        <Button size="sm" onClick={handleCreate}>
          <Plus className="size-4 mr-1.5" />
          Agregar producto
        </Button>
      </div>

      {/* Table */}
      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center text-muted-foreground">
          <p className="text-sm">No hay productos. Carga un Excel o agrega uno manualmente.</p>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="inline-block size-3 rounded-sm bg-orange-200 dark:bg-orange-800" />
              Sin datos
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block size-3 rounded-sm bg-muted-foreground/30" />
              Sin código modelo
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block size-3 rounded-sm bg-yellow-200 dark:bg-yellow-800" />
              Sin cantidad
            </span>
          </div>

          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="px-2 py-3 w-8"><span className="sr-only">Reordenar</span></th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">ETM</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Descripción</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Código</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Marca</th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground">Precio unit.</th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground">Cant.</th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground">Subtotal</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Entrega</th>
                  <th className="px-4 py-3 text-center font-medium text-muted-foreground">Origen</th>
                  <th className="px-4 py-3 text-center font-medium text-muted-foreground">Acciones</th>
                </tr>
              </thead>
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={items.map((i) => i._id)} strategy={verticalListSortingStrategy}>
                  <tbody>
                    {items.map((item) =>
                      item.item_type === 'separator' ? (
                        <SortableSeparatorRow
                          key={item._id}
                          item={item}
                          colSpan={11}
                          onLabelChange={(id, label) => updateItem(id, { section_label: label })}
                          onRemove={removeItem}
                        />
                      ) : (
                        <SortableRow
                          key={item._id}
                          item={item}
                          onEdit={handleEdit}
                          onRemove={removeItem}
                          onAddSeparatorAfter={addSeparatorAfter}
                        />
                      )
                    )}
                  </tbody>
                </SortableContext>
              </DndContext>
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
        existingEtms={items.flatMap((i) =>
          isProductItem(i) && i._id !== selectedItem?._id ? [i.etm] : []
        )}
      />
    </div>
  )
}
