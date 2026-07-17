'use client'

import { memo, forwardRef, useCallback, useMemo, useRef, useState } from 'react'
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
import { useVirtualizer } from '@tanstack/react-virtual'
import { Plus, Pencil, Trash2, AlertTriangle, AlertCircle, CheckCircle2, GripVertical, SeparatorHorizontal, ChevronUp, ChevronDown } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { ProductModal } from './ProductModal'
import { DELIVERY_TIME_LABELS } from '@/lib/delivery'
import { useQuotationStore } from '@/stores/quotationStore'
import { useCurrency } from '@/hooks/useCurrency'
import { useVisibleColumns, type TableColumn } from '@/hooks/useVisibleColumns'
import { ColumnPicker } from '@/components/ColumnPicker'
import { calculateQuotationTotal, isProductItem, isNotSold, resolveDymmsaDescription, type DymmsaDescriptionSource } from '@/lib/business-rules'
import { notSoldRowClass } from '@/lib/sold-status'
import { SoldStatusBadge } from '@/components/quotations/SoldStatusBadge'
import type { QuotationItemRow } from '@/types/database'

// Arriba de este número de ítems el drag & drop se apaga y se reordena con
// flechas ↑↓ sobre una tabla virtualizada (issue #29). Debajo, la lista se
// renderiza completa con drag — 300 filas vuelan con el memo por fila arreglado.
// Así virtualización y DnD nunca coexisten (dnd-kit necesita la fila montada
// para soltar sobre ella; virtualizar desmonta las fuera de viewport).
const DRAG_MAX_ITEMS = 300

// Columnas del editor (issue #18). Los ids son API persistida (localStorage).
// drag/ETM/Acciones son fijas: sin identificador ni acciones la fila queda inoperable.
const EDITOR_COLUMNS: readonly TableColumn[] = [
  { id: 'drag', label: 'Reordenar', hideable: false },
  { id: 'etm', label: 'ETM', hideable: false },
  { id: 'description', label: 'Descripción' },
  { id: 'dymmsa_description', label: 'Desc. DYMMSA' },
  { id: 'model_code', label: 'Código' },
  { id: 'brand', label: 'Marca' },
  { id: 'unit_price', label: 'Precio unit.' },
  { id: 'quantity', label: 'Cant.' },
  { id: 'subtotal', label: 'Subtotal' },
  { id: 'delivery', label: 'Entrega' },
  { id: 'origin', label: 'Origen' },
  { id: 'sold', label: 'Venta' },
  { id: 'actions', label: 'Acciones', hideable: false },
]

// Anchos para el modo virtualizado (table-fixed): sin ellos las columnas saltan
// al scrollear porque solo ~20 filas definen su ancho. El contenido se trunca.
const COLUMN_WIDTHS: Record<string, string> = {
  control: '3rem',
  etm: '7.5rem',
  description: '13rem',
  dymmsa_description: '13rem',
  model_code: '6.5rem',
  brand: '6rem',
  unit_price: '6.5rem',
  quantity: '4.5rem',
  subtotal: '7rem',
  delivery: '7rem',
  origin: '6rem',
  sold: '6rem',
  actions: '7rem',
}

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
  // "No lo vendemos" tiene prioridad: no importa que falten datos, se salta.
  if (isNotSold(item)) return notSoldRowClass(item.is_sold)
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

const rowClassName = (item: QuotationItemRow, hasError: boolean, isDragging: boolean): string =>
  `border-b border-border/60 ${getRowClass(item)} ${isDragging ? 'shadow-lg' : ''} ${
    hasError ? 'outline outline-2 -outline-offset-1 outline-red-500 bg-red-50 dark:bg-red-950/30' : ''
  }`

// --- shared cells (ETM → Acciones) ------------------------------------
// Compartidas por la fila de drag y la virtualizada: la única diferencia entre
// modos es la PRIMERA celda (grip vs flechas), todo lo demás es idéntico.

interface RowCellsProps {
  item: QuotationItemRow
  onEdit: (item: QuotationItemRow) => void
  onRemove: (id: string) => void
  onAddSeparatorAfter: (id: string) => void
  dymmsaDesc?: { value: string | null; source: DymmsaDescriptionSource }
  isVisible: (columnId: string) => boolean
}

const RowCells = memo(function RowCells({
  item, onEdit, onRemove, onAddSeparatorAfter, dymmsaDesc, isVisible,
}: RowCellsProps) {
  const fmt = useCurrency()
  return (
    <>
      <td className="px-4 py-3 font-mono text-xs font-medium truncate">{item.etm}</td>
      {isVisible('description') && (
        <td className="px-4 py-3 max-w-52">
          {item.description ? (
            <span className="truncate block" title={item.description}>{item.description}</span>
          ) : (
            <span className="text-muted-foreground italic text-xs">Sin descripción</span>
          )}
        </td>
      )}
      {isVisible('dymmsa_description') && (
        <td className="px-4 py-3 max-w-52">
          {dymmsaDesc?.value ? (
            <span className="flex items-center gap-1.5 min-w-0">
              <span className="truncate" title={dymmsaDesc.value}>{dymmsaDesc.value}</span>
              {dymmsaDesc.source === 'catalog' && (
                <Badge variant="secondary" className="text-[10px] shrink-0 px-1 py-0">URREA</Badge>
              )}
            </span>
          ) : (
            <span className="text-muted-foreground italic text-xs">Sin descripción</span>
          )}
        </td>
      )}
      {isVisible('model_code') && (
        <td className="px-4 py-3 font-mono text-xs truncate">
          {item.model_code || <span className="text-muted-foreground">{'—'}</span>}
        </td>
      )}
      {isVisible('brand') && (
        <td className="px-4 py-3 truncate">
          {item.brand || <span className="text-muted-foreground">{'—'}</span>}
        </td>
      )}
      {isVisible('unit_price') && (
        <td className="px-4 py-3 text-right tabular-nums">
          {item.unit_price != null
            ? fmt(item.unit_price)
            : <span className="text-muted-foreground">{'—'}</span>}
        </td>
      )}
      {isVisible('quantity') && (
        <td className="px-4 py-3 text-right tabular-nums">
          {item.quantity != null ? item.quantity : <span className="text-muted-foreground">{'—'}</span>}
        </td>
      )}
      {isVisible('subtotal') && (
        <td className="px-4 py-3 text-right tabular-nums">
          {item.unit_price != null && item.quantity != null ? (
            <span className="font-medium">
              {fmt(item.unit_price * item.quantity)}
            </span>
          ) : (
            <span className="text-muted-foreground">{'—'}</span>
          )}
        </td>
      )}
      {isVisible('delivery') && (
        <td className="px-4 py-3 text-sm text-muted-foreground whitespace-nowrap truncate">
          {DELIVERY_TIME_LABELS[item.delivery_time] ?? '—'}
        </td>
      )}
      {isVisible('origin') && (
        <td className="px-4 py-3 text-center">
          {item._inDb ? (
            <Badge variant="secondary" className="text-xs">Catálogo</Badge>
          ) : (
            <Badge variant="outline" className="text-xs text-amber-600 border-amber-300">Nuevo</Badge>
          )}
        </td>
      )}
      {isVisible('sold') && (
        <td className="px-4 py-3 text-center">
          <SoldStatusBadge value={item.is_sold} />
        </td>
      )}
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
    </>
  )
})

// --- reorder-by-arrows control cell (modo virtualizado) ---------------

interface ReorderCellProps {
  onMoveUp: () => void
  onMoveDown: () => void
  isFirst: boolean
  isLast: boolean
}

function ReorderCell({ onMoveUp, onMoveDown, isFirst, isLast }: ReorderCellProps) {
  return (
    <td className="px-1 py-1 w-12">
      <div className="flex flex-col items-center">
        <Button
          size="icon" variant="ghost"
          className="size-5 text-muted-foreground/60 hover:text-foreground disabled:opacity-30"
          onClick={onMoveUp}
          disabled={isFirst}
          aria-label="Mover arriba"
        >
          <ChevronUp className="size-3.5" />
        </Button>
        <Button
          size="icon" variant="ghost"
          className="size-5 text-muted-foreground/60 hover:text-foreground disabled:opacity-30"
          onClick={onMoveDown}
          disabled={isLast}
          aria-label="Mover abajo"
        >
          <ChevronDown className="size-3.5" />
        </Button>
      </div>
    </td>
  )
}

// --- sortable separator row (modo drag) -------------------------------

interface SortableSeparatorRowProps {
  item: QuotationItemRow
  onLabelChange: (id: string, label: string) => void
  onRemove: (id: string) => void
  /** Columnas que abarca el label = visibles − 2 (drag y Acciones son fijas). */
  labelSpan: number
}

const SortableSeparatorRow = memo(function SortableSeparatorRow({
  item, onLabelChange, onRemove, labelSpan,
}: SortableSeparatorRowProps) {
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
      <td className="p-2 w-8">
        <button type="button"
          {...attributes}
          {...listeners}
          className="cursor-grab active:cursor-grabbing text-muted-foreground/40 hover:text-muted-foreground transition-colors touch-none"
          aria-label="Arrastrar separador"
        >
          <GripVertical className="size-4" />
        </button>
      </td>
      <SeparatorLabelCells
        item={item}
        labelSpan={labelSpan}
        onLabelChange={onLabelChange}
        onRemove={onRemove}
      />
    </tr>
  )
})

// Celdas compartidas del separador (label editable + eliminar).
interface SeparatorLabelCellsProps {
  item: QuotationItemRow
  labelSpan: number
  onLabelChange: (id: string, label: string) => void
  onRemove: (id: string) => void
}

const SeparatorLabelCells = memo(function SeparatorLabelCells({
  item, labelSpan, onLabelChange, onRemove,
}: SeparatorLabelCellsProps) {
  // Estado local del input: cada keystroke ya no llama updateItem (que
  // re-renderiza todas las filas y escribe a localStorage). Commit en blur.
  // Sincronía prop→estado con el patrón "derivar durante render" de las docs de
  // React (adjusting state when a prop changes) en vez de setState en efecto.
  const [localLabel, setLocalLabel] = useState(item.section_label ?? '')
  const [prevLabel, setPrevLabel] = useState(item.section_label)
  if (prevLabel !== item.section_label) {
    setPrevLabel(item.section_label)
    setLocalLabel(item.section_label ?? '')
  }

  return (
    <>
      <td colSpan={labelSpan} className="px-4 py-2">
        <div className="flex items-center gap-2">
          <SeparatorHorizontal className="size-3.5 text-muted-foreground shrink-0" />
          <Input
            value={localLabel}
            onChange={(e) => setLocalLabel(e.target.value)}
            onBlur={() => {
              if (localLabel !== (item.section_label ?? '')) {
                onLabelChange(item._id, localLabel)
              }
            }}
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
    </>
  )
})

// --- sortable product row (modo drag) ---------------------------------

interface SortableRowProps {
  item: QuotationItemRow
  onEdit: (item: QuotationItemRow) => void
  onRemove: (id: string) => void
  onAddSeparatorAfter: (id: string) => void
  hasError?: boolean
  /** Descripción DYMMSA resuelta (catálogo > curada > null) + su origen. */
  dymmsaDesc?: { value: string | null; source: DymmsaDescriptionSource }
  /** Visibilidad de columnas (identidad estable — no rompe el memo). */
  isVisible: (columnId: string) => boolean
}

const SortableRow = memo(function SortableRow({
  item, onEdit, onRemove, onAddSeparatorAfter, hasError = false, dymmsaDesc, isVisible,
}: SortableRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: item._id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <tr ref={setNodeRef} style={style} data-row-id={item._id} className={rowClassName(item, hasError, isDragging)}>
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
      <RowCells
        item={item}
        onEdit={onEdit}
        onRemove={onRemove}
        onAddSeparatorAfter={onAddSeparatorAfter}
        dymmsaDesc={dymmsaDesc}
        isVisible={isVisible}
      />
    </tr>
  )
})

// --- virtualized rows (modo >300 ítems, reordenar con flechas) --------

interface VirtualRowProps extends RowCellsProps {
  hasError?: boolean
  isFirst: boolean
  isLast: boolean
  onMove: (id: string, direction: 'up' | 'down') => void
  onLabelChange: (id: string, label: string) => void
  labelSpan: number
}

// forwardRef: react-virtual mide cada fila por su nodo (`measureElement`) para
// soportar alturas mixtas (producto vs separador).
const VirtualRow = memo(forwardRef<HTMLTableRowElement, VirtualRowProps & { dataIndex: number }>(
  function VirtualRow(props, ref) {
    const { item, hasError = false, isFirst, isLast, onMove, dataIndex } = props

    if (item.item_type === 'separator') {
      return (
        <tr
          ref={ref}
          data-index={dataIndex}
          className="border-b border-dashed border-border/60 bg-muted/30"
        >
          <ReorderCell
            onMoveUp={() => onMove(item._id, 'up')}
            onMoveDown={() => onMove(item._id, 'down')}
            isFirst={isFirst}
            isLast={isLast}
          />
          <SeparatorLabelCells
            item={item}
            labelSpan={props.labelSpan}
            onLabelChange={props.onLabelChange}
            onRemove={props.onRemove}
          />
        </tr>
      )
    }

    return (
      <tr ref={ref} data-index={dataIndex} data-row-id={item._id} className={rowClassName(item, hasError, false)}>
        <ReorderCell
          onMoveUp={() => onMove(item._id, 'up')}
          onMoveDown={() => onMove(item._id, 'down')}
          isFirst={isFirst}
          isLast={isLast}
        />
        <RowCells
          item={item}
          onEdit={props.onEdit}
          onRemove={props.onRemove}
          onAddSeparatorAfter={props.onAddSeparatorAfter}
          dymmsaDesc={props.dymmsaDesc}
          isVisible={props.isVisible}
        />
      </tr>
    )
  },
))

// --- table header (compartido) ----------------------------------------

interface HeaderProps {
  isVisible: (id: string) => boolean
  sticky?: boolean
}

function TableHeader({ isVisible, sticky = false }: HeaderProps) {
  const thBase = `px-4 py-3 font-medium text-muted-foreground ${sticky ? 'sticky top-0 z-10 bg-muted/95 backdrop-blur' : 'bg-muted/50'}`
  return (
    <thead>
      <tr className="border-b">
        <th className={`px-2 py-3 w-12 ${sticky ? 'sticky top-0 z-10 bg-muted/95 backdrop-blur' : 'bg-muted/50'}`}><span className="sr-only">Reordenar</span></th>
        <th className={`${thBase} text-left`}>ETM</th>
        {isVisible('description') && <th className={`${thBase} text-left`}>Descripción</th>}
        {isVisible('dymmsa_description') && <th className={`${thBase} text-left`}>Desc. DYMMSA</th>}
        {isVisible('model_code') && <th className={`${thBase} text-left`}>Código</th>}
        {isVisible('brand') && <th className={`${thBase} text-left`}>Marca</th>}
        {isVisible('unit_price') && <th className={`${thBase} text-right`}>Precio unit.</th>}
        {isVisible('quantity') && <th className={`${thBase} text-right`}>Cant.</th>}
        {isVisible('subtotal') && <th className={`${thBase} text-right`}>Subtotal</th>}
        {isVisible('delivery') && <th className={`${thBase} text-left`}>Entrega</th>}
        {isVisible('origin') && <th className={`${thBase} text-center`}>Origen</th>}
        {isVisible('sold') && <th className={`${thBase} text-center`}>Venta</th>}
        <th className={`${thBase} text-center`}>Acciones</th>
      </tr>
    </thead>
  )
}

/** <colgroup> para el modo virtualizado (table-fixed): evita el salto de columnas. */
function ColGroup({ isVisible }: { isVisible: (id: string) => boolean }) {
  const bodyCols = EDITOR_COLUMNS.filter((c) => c.id !== 'drag' && (c.hideable === false || isVisible(c.id)))
  return (
    <colgroup>
      <col style={{ width: COLUMN_WIDTHS.control }} />
      {bodyCols.map((c) => (
        <col key={c.id} style={{ width: COLUMN_WIDTHS[c.id] }} />
      ))}
    </colgroup>
  )
}

// --- component --------------------------------------------------------

interface QuotationEditorProps {
  /** _id de filas con error pre-flight para resaltarlas. */
  errorItemIds?: ReadonlySet<string>
}

function QuotationEditorComponent({ errorItemIds }: QuotationEditorProps = {}) {
  // Selectores slice: el editor solo re-renderiza cuando cambia su slice;
  // tipear en name/customer_name no lo afecta. Las acciones de Zustand son
  // refs estables, así que los selectores de acción no causan re-renders.
  const items = useQuotationStore((s) => s.items)
  const addItem = useQuotationStore((s) => s.addItem)
  const updateItem = useQuotationStore((s) => s.updateItem)
  const addSeparatorAfter = useQuotationStore((s) => s.addSeparatorAfter)
  const removeItem = useQuotationStore((s) => s.removeItem)
  const reorderItems = useQuotationStore((s) => s.reorderItems)
  const moveItem = useQuotationStore((s) => s.moveItem)
  const catalogDescriptions = useQuotationStore((s) => s.catalogDescriptions)
  const mergeCatalogDescriptions = useQuotationStore((s) => s.mergeCatalogDescriptions)

  // Map para resolveDymmsaDescription (catálogo > curada > null).
  // Indexado por catalogKey (MARCA|CODIGO): el resolver cruza con la marca del ítem.
  const catalogMap = useMemo(
    () => new Map(Object.entries(catalogDescriptions ?? {})),
    [catalogDescriptions]
  )

  const fmt = useCurrency()
  const productItems = useMemo(() => items.filter(isProductItem), [items])
  const cols = useVisibleColumns('quoter-editor', EDITOR_COLUMNS)

  // Descripción DYMMSA resuelta por fila, memoizada por _id. Resolverla inline en
  // el map (`resolveDymmsaDescription(item, catalogMap)`) creaba un objeto nuevo
  // por render → rompía el React.memo de SortableRow y repintaba las 1000 filas
  // en CADA render del editor (p.ej. tipear el nombre de la cotización). Con el
  // Map memoizado la referencia es estable salvo que cambien items/catálogo.
  const dymmsaByRow = useMemo(() => {
    const map = new Map<string, { value: string | null; source: DymmsaDescriptionSource }>()
    for (const item of items) map.set(item._id, resolveDymmsaDescription(item, catalogMap))
    return map
  }, [items, catalogMap])

  const [modalOpen, setModalOpen]       = useState(false)
  const [modalMode, setModalMode]       = useState<'edit' | 'create'>('create')
  const [selectedItem, setSelectedItem] = useState<QuotationItemRow | undefined>()

  const sensors = useSensors(useSensor(PointerSensor))

  // Arriba del umbral: virtualizar + reordenar con flechas (sin DnD).
  const virtualized = items.length > DRAG_MAX_ITEMS

  // Callbacks memoizados — habilita React.memo en las filas: sin ref estable de
  // los handlers, memo no evita re-render alguno. Los setters van en deps: son
  // estables y el React Compiler exige listar toda dependencia inferida.
  const handleEdit = useCallback((item: QuotationItemRow) => {
    setSelectedItem(item)
    setModalMode('edit')
    setModalOpen(true)
  }, [setSelectedItem, setModalMode, setModalOpen])

  const handleCreate = useCallback(() => {
    setSelectedItem(undefined)
    setModalMode('create')
    setModalOpen(true)
  }, [setSelectedItem, setModalMode, setModalOpen])

  const handleModalSave = useCallback((data: Omit<QuotationItemRow, '_id'>, id?: string) => {
    if (id) {
      updateItem(id, data)
    } else {
      addItem(data)
    }
  }, [updateItem, addItem])

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event
    if (over && active.id !== over.id) {
      reorderItems(String(active.id), String(over.id))
    }
  }, [reorderItems])

  const handleLabelChange = useCallback((id: string, label: string) => {
    updateItem(id, { section_label: label })
  }, [updateItem])

  // IDs estables para SortableContext: items.map(...) creaba un array nuevo cada
  // render → @dnd-kit reinicializaba los sortables. Con useMemo solo cambia
  // cuando items cambia.
  const itemIds = useMemo(() => items.map((i) => i._id), [items])

  // --- stats (only product rows) --- un solo paso sobre productItems.
  const { noDataCount, noQuantityCount, completeCount, partialTotal } = useMemo(() => {
    let noData = 0, noQty = 0, complete = 0
    for (const item of productItems) {
      if (isMissingData(item)) noData++
      else if (isMissingQuantity(item)) noQty++
      if (isComplete(item)) complete++
    }
    return {
      noDataCount: noData,
      noQuantityCount: noQty,
      completeCount: complete,
      partialTotal: calculateQuotationTotal(productItems),
    }
  }, [productItems])

  const allComplete = productItems.length > 0 && noDataCount === 0 && noQuantityCount === 0

  // ETMs presentes (excluye la fila en edición) para el aviso de duplicado del modal.
  const existingEtms = useMemo(
    () => items.flatMap((i) =>
      isProductItem(i) && i._id !== selectedItem?._id ? [i.etm] : []
    ),
    [items, selectedItem?._id],
  )

  const labelSpan = cols.visibleCount - 2

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
        <div className="flex items-center gap-2">
          <ColumnPicker tableId="quoter-editor" columns={EDITOR_COLUMNS} />
          <Button size="sm" onClick={handleCreate}>
            <Plus className="size-4 mr-1.5" />
            Agregar producto
          </Button>
        </div>
      </div>

      {/* Table */}
      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center text-muted-foreground">
          <p className="text-sm">No hay productos. Carga un Excel o agrega uno manualmente.</p>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-4 text-xs text-muted-foreground flex-wrap">
            <div className="flex items-center gap-4">
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
            {virtualized && (
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <ChevronUp className="size-3" />
                Reordena con las flechas (el arrastre se activa con {DRAG_MAX_ITEMS} productos o menos)
              </span>
            )}
          </div>

          {virtualized ? (
            <VirtualizedTable
              items={items}
              cols={cols}
              labelSpan={labelSpan}
              dymmsaByRow={dymmsaByRow}
              errorItemIds={errorItemIds}
              onEdit={handleEdit}
              onRemove={removeItem}
              onAddSeparatorAfter={addSeparatorAfter}
              onMove={moveItem}
              onLabelChange={handleLabelChange}
            />
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <TableHeader isVisible={cols.isVisible} />
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                  <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
                    <tbody>
                      {items.map((item) =>
                        item.item_type === 'separator' ? (
                          <SortableSeparatorRow
                            key={item._id}
                            item={item}
                            labelSpan={labelSpan}
                            onLabelChange={handleLabelChange}
                            onRemove={removeItem}
                          />
                        ) : (
                          <SortableRow
                            key={item._id}
                            item={item}
                            onEdit={handleEdit}
                            onRemove={removeItem}
                            onAddSeparatorAfter={addSeparatorAfter}
                            hasError={errorItemIds?.has(item._id) ?? false}
                            dymmsaDesc={dymmsaByRow.get(item._id)}
                            isVisible={cols.isVisible}
                          />
                        )
                      )}
                    </tbody>
                  </SortableContext>
                </DndContext>
              </table>
            </div>
          )}
        </div>
      )}

      <ProductModal
        mode={modalMode}
        item={selectedItem}
        open={modalOpen}
        onOpenChange={setModalOpen}
        onSave={handleModalSave}
        onCatalogResolved={(code, description) => mergeCatalogDescriptions({ [code]: description })}
        existingEtms={existingEtms}
      />
    </div>
  )
}

// --- virtualized table body -------------------------------------------

interface VirtualizedTableProps {
  items: QuotationItemRow[]
  cols: ReturnType<typeof useVisibleColumns>
  labelSpan: number
  dymmsaByRow: Map<string, { value: string | null; source: DymmsaDescriptionSource }>
  errorItemIds?: ReadonlySet<string>
  onEdit: (item: QuotationItemRow) => void
  onRemove: (id: string) => void
  onAddSeparatorAfter: (id: string) => void
  onMove: (id: string, direction: 'up' | 'down') => void
  onLabelChange: (id: string, label: string) => void
}

function VirtualizedTable({
  items, cols, labelSpan, dymmsaByRow, errorItemIds,
  onEdit, onRemove, onAddSeparatorAfter, onMove, onLabelChange,
}: VirtualizedTableProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const totalCols = cols.visibleCount // control + body cols

  // useVirtualizer devuelve funciones no memoizables: incompatibilidad conocida
  // del React Compiler (igual que watch() de react-hook-form). Este componente
  // solo se queda sin auto-memoizar — sin impacto funcional.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 49,
    overscan: 12,
  })

  const virtualRows = virtualizer.getVirtualItems()
  const totalSize = virtualizer.getTotalSize()
  const paddingTop = virtualRows.length > 0 ? virtualRows[0].start : 0
  const paddingBottom = virtualRows.length > 0 ? totalSize - virtualRows[virtualRows.length - 1].end : 0

  return (
    <div ref={scrollRef} className="overflow-auto rounded-lg border max-h-[70vh]">
      <table className="w-full text-sm table-fixed">
        <ColGroup isVisible={cols.isVisible} />
        <TableHeader isVisible={cols.isVisible} sticky />
        <tbody>
          {paddingTop > 0 && (
            <tr aria-hidden><td colSpan={totalCols} style={{ height: paddingTop }} /></tr>
          )}
          {virtualRows.map((vRow) => {
            const item = items[vRow.index]
            return (
              <VirtualRow
                key={item._id}
                ref={virtualizer.measureElement}
                dataIndex={vRow.index}
                item={item}
                isFirst={vRow.index === 0}
                isLast={vRow.index === items.length - 1}
                hasError={errorItemIds?.has(item._id) ?? false}
                dymmsaDesc={dymmsaByRow.get(item._id)}
                isVisible={cols.isVisible}
                labelSpan={labelSpan}
                onEdit={onEdit}
                onRemove={onRemove}
                onAddSeparatorAfter={onAddSeparatorAfter}
                onMove={onMove}
                onLabelChange={onLabelChange}
              />
            )
          })}
          {paddingBottom > 0 && (
            <tr aria-hidden><td colSpan={totalCols} style={{ height: paddingBottom }} /></tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

// memo: el editor lee sus datos del store con selectores propios, así que solo
// re-renderiza cuando cambia su slice o su única prop (errorItemIds, identidad
// estable). Sin esto, tipear el nombre/cliente en la página padre lo repintaba.
export const QuotationEditor = memo(QuotationEditorComponent)
