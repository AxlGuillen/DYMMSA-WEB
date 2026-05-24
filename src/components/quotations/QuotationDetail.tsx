'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
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
import {
  ArrowLeft,
  Send,
  Copy,
  Check,
  Pencil,
  Trash2,
  Plus,
  Loader2,
  Package,
  CheckCircle2,
  XCircle,
  Clock,
  ShoppingCart,
  GripVertical,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  ExternalLink,
  AlertCircle,
  RotateCcw,
  SeparatorHorizontal,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableFooter,
} from '@/components/ui/table'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { QuotationStatusBadge } from './QuotationStatusBadge'
import { ProductModal } from '@/components/quoter/ProductModal'
import { DELIVERY_TIME_LABELS } from '@/lib/delivery'
import { useSendForApproval, useUpdateQuotation, useCreateOrderFromQuotation, useDeleteQuotation } from '@/hooks/useQuotations'
import { useOrderByQuotationId } from '@/hooks/useOrders'
import { useCurrency } from '@/hooks/useCurrency'
import { calculateQuotationTotal, isProductItem as isProductRow } from '@/lib/business-rules'
import type { QuotationWithItems, QuotationItem, QuotationItemRow, DeliveryTime } from '@/types/database'

// ------------------------------------------------------------------ //
// Types                                                               //
// ------------------------------------------------------------------ //

type ApprovalFilter = 'all' | 'approved' | 'rejected' | 'pending'
type SortField = 'description' | 'unit_price' | 'quantity' | 'delivery_time'
type SortDir = 'asc' | 'desc'

const DELIVERY_ORDER: Record<DeliveryTime, number> = {
  immediate: 0,
  '2_3_days': 1,
  '3_5_days': 2,
  '1_week':   3,
  '2_weeks':  4,
  indefinite: 5,
}

// ------------------------------------------------------------------ //
// SortableHead (matches ProductsTable pattern)                        //
// ------------------------------------------------------------------ //

function SortableHead({
  col,
  currentSort,
  currentDir,
  onSort,
  children,
  className,
}: {
  col: SortField
  currentSort: SortField | null
  currentDir: SortDir
  onSort: (col: SortField) => void
  children: React.ReactNode
  className?: string
}) {
  const isActive = currentSort === col
  const isRight  = className?.includes('text-right')
  return (
    <TableHead className={className}>
      <button type="button"
        onClick={() => onSort(col)}
        className={`flex items-center gap-1 w-full select-none transition-colors hover:text-foreground ${
          isRight ? 'justify-end' : ''
        } ${isActive ? 'text-foreground font-semibold' : 'text-muted-foreground'}`}
      >
        {children}
        {isActive ? (
          currentDir === 'asc'
            ? <ArrowUp className="size-3.5" />
            : <ArrowDown className="size-3.5" />
        ) : (
          <ArrowUpDown className="size-3.5 opacity-30" />
        )}
      </button>
    </TableHead>
  )
}

// ------------------------------------------------------------------ //
// Sortable separator row                                              //
// ------------------------------------------------------------------ //

interface SortableSeparatorDetailRowProps {
  item: QuotationItemRow
  canEdit: boolean
  isDndEnabled: boolean
  totalCols: number
  onLabelChange: (id: string, label: string) => void
  onRemove: (id: string) => void
}

function SortableSeparatorDetailRow({
  item, canEdit, isDndEnabled, totalCols, onLabelChange, onRemove,
}: SortableSeparatorDetailRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: item._id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  }

  return (
    <TableRow
      ref={setNodeRef}
      style={style}
      className={`border-b border-dashed border-border/60 bg-muted/30 ${isDragging ? 'shadow-lg' : ''}`}
    >
      {canEdit && (
        <TableCell className="w-8 px-2">
          {isDndEnabled ? (
            <button type="button"
              {...attributes}
              {...listeners}
              className="cursor-grab active:cursor-grabbing text-muted-foreground/40 hover:text-muted-foreground transition-colors touch-none"
              aria-label="Arrastrar separador"
            >
              <GripVertical className="size-4" />
            </button>
          ) : (
            <span className="block w-4" />
          )}
        </TableCell>
      )}
      <TableCell colSpan={totalCols - (canEdit ? 2 : 0)} className="px-4 py-2">
        {canEdit ? (
          <div className="flex items-center gap-2">
            <SeparatorHorizontal className="size-3.5 text-muted-foreground shrink-0" />
            <Input
              value={item.section_label ?? ''}
              onChange={(e) => onLabelChange(item._id, e.target.value)}
              placeholder="Nombre de la sección (opcional)..."
              className="h-7 text-xs bg-transparent border-dashed focus-visible:border-solid"
            />
          </div>
        ) : (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <SeparatorHorizontal className="size-3.5 shrink-0" />
            <span className="font-medium">{item.section_label || 'Sección'}</span>
          </div>
        )}
      </TableCell>
      {canEdit && (
        <TableCell>
          <div className="flex items-center justify-center">
            <Button
              size="icon" variant="ghost"
              className="size-7 text-destructive hover:text-destructive hover:bg-destructive/10"
              onClick={() => onRemove(item._id)}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        </TableCell>
      )}
    </TableRow>
  )
}

// ------------------------------------------------------------------ //
// Sortable row                                                        //
// ------------------------------------------------------------------ //

interface SortableDetailRowProps {
  item: QuotationItemRow
  canEdit: boolean
  isDndEnabled: boolean
  isApproved: boolean
  isSentForApproval: boolean
  dbItem: QuotationItem | undefined
  onEdit: (item: QuotationItemRow) => void
  onRemove: (id: string) => void
  onAddSeparatorAfter: (id: string) => void
}

// oxlint-disable-next-line react-doctor/no-many-boolean-props -- intentional pattern; structural refactor tracked separately
function SortableDetailRow({
  item, canEdit, isDndEnabled, isApproved, isSentForApproval, dbItem, onEdit, onRemove, onAddSeparatorAfter,
}: SortableDetailRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: item._id })
  const fmt = useCurrency()

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <TableRow
      ref={setNodeRef}
      style={style}
      className={`border-b border-border/60 ${getRowClass(item)} ${isDragging ? 'shadow-lg' : ''}`}
    >
      {canEdit && (
        <TableCell className="w-8 px-2">
          {isDndEnabled ? (
            <button type="button"
              {...attributes}
              {...listeners}
              className="cursor-grab active:cursor-grabbing text-muted-foreground/40 hover:text-muted-foreground transition-colors touch-none"
              aria-label="Arrastrar para reordenar"
            >
              <GripVertical className="size-4" />
            </button>
          ) : (
            <span className="block w-4" />
          )}
        </TableCell>
      )}
      <TableCell className="font-mono text-xs font-medium">{item.etm || '—'}</TableCell>
      <TableCell className="max-w-52">
        {item.description
          ? <span className="truncate block" title={item.description}>{item.description}</span>
          : <span className="text-muted-foreground italic text-xs">Sin descripción</span>}
      </TableCell>
      <TableCell className="font-mono text-xs">{item.model_code || <span className="text-muted-foreground">{'\u2014'}</span>}</TableCell>
      <TableCell>{item.brand || <span className="text-muted-foreground">{'\u2014'}</span>}</TableCell>
      <TableCell className="text-right tabular-nums">
        {item.unit_price != null
          ? fmt(item.unit_price)
          : <span className="text-muted-foreground">{'\u2014'}</span>}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {item.quantity ?? <span className="text-muted-foreground">{'\u2014'}</span>}
      </TableCell>
      <TableCell className="text-right tabular-nums font-medium">
        {item.unit_price != null && item.quantity != null
          ? fmt(item.unit_price * item.quantity)
          : <span className="text-muted-foreground">{'\u2014'}</span>}
      </TableCell>
      <TableCell className="text-sm whitespace-nowrap">
        {item.delivery_time
          ? DELIVERY_TIME_LABELS[item.delivery_time] ?? '—'
          : <span className="text-muted-foreground">{'\u2014'}</span>}
      </TableCell>
      {(isApproved || isSentForApproval) && (
        <TableCell className="text-center">
          {dbItem?.is_approved === true
            ? <Badge variant="outline" className="text-xs text-green-600 border-green-300"><CheckCircle2 className="size-3 mr-1" />Aprobado</Badge>
            : dbItem?.is_approved === false
              ? <Badge variant="outline" className="text-xs text-red-600 border-red-300"><XCircle className="size-3 mr-1" />Rechazado</Badge>
              : <Badge variant="outline" className="text-xs text-muted-foreground"><Clock className="size-3 mr-1" />Pendiente</Badge>}
        </TableCell>
      )}
      {canEdit && (
        <TableCell>
          <div className="flex items-center justify-center gap-1">
            <Button
              size="icon" variant="ghost"
              className="size-7 text-muted-foreground hover:text-foreground"
              title="Insertar separador debajo"
              onClick={() => onAddSeparatorAfter(item._id)}
            >
              <SeparatorHorizontal className="size-3.5" />
            </Button>
            <Button size="icon" variant="ghost" className="size-7" onClick={() => onEdit(item)}>
              <Pencil className="size-3.5" />
            </Button>
            <Button
              size="icon" variant="ghost"
              className="size-7 text-destructive hover:text-destructive hover:bg-destructive/10"
              onClick={() => onRemove(item._id)}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        </TableCell>
      )}
    </TableRow>
  )
}

// ------------------------------------------------------------------ //
// Helpers                                                             //
// ------------------------------------------------------------------ //

const toItemRow = (item: QuotationItem): QuotationItemRow => ({
  _id:            item.id,
  _dbId:          item.id,
  item_type:      item.item_type      ?? 'product',
  section_label:  item.section_label  ?? '',
  etm:            item.etm            ?? '',
  description:    item.description    ?? '',
  description_es: item.description_es ?? '',
  model_code:     item.model_code     ?? '',
  brand:          item.brand          ?? '',
  unit_price:     item.unit_price,
  quantity:       item.quantity,
  delivery_time:  item.delivery_time ?? 'immediate',
  _inDb:          !!(item.model_code || item.description),
})

const isMissingData     = (item: QuotationItemRow) => isProductRow(item) && !item.description && !item.model_code
const isMissingQuantity = (item: QuotationItemRow) => isProductRow(item) && !isMissingData(item) && item.quantity == null

const getRowClass = (item: QuotationItemRow) => {
  if (isMissingData(item))     return 'bg-orange-50 dark:bg-orange-950/20'
  if (isMissingQuantity(item)) return 'bg-yellow-50 dark:bg-yellow-950/20'
  return ''
}

// ------------------------------------------------------------------ //
// Component                                                           //
// ------------------------------------------------------------------ //

interface QuotationDetailProps {
  quotation: QuotationWithItems
}

// oxlint-disable-next-line react-doctor/no-giant-component, react-doctor/prefer-useReducer -- intentional pattern; structural refactor tracked separately
export function QuotationDetail({ quotation }: QuotationDetailProps) {
  const { refresh, push } = useRouter()
  const fmt = useCurrency()

  // ── Draft editing state ─────────────────────────────────────────
  // oxlint-disable-next-line react-doctor/no-derived-useState -- intentional pattern; structural refactor tracked separately
  const [localQuotationName, setLocalQuotationName] = useState(quotation.name)
  // oxlint-disable-next-line react-doctor/no-derived-useState -- intentional pattern; structural refactor tracked separately
  const [localName, setLocalName]   = useState(quotation.customer_name)
  const [localItems, setLocalItems] = useState<QuotationItemRow[]>(
    () => quotation.quotation_items.map(toItemRow)
  )
  const [isDirty, setIsDirty] = useState(false)

  // Modal state
  const [modalOpen, setModalOpen]       = useState(false)
  const [modalMode, setModalMode]       = useState<'edit' | 'create'>('create')
  const [selectedItem, setSelectedItem] = useState<QuotationItemRow | undefined>()

  // Copy-link state
  const [copied, setCopied] = useState(false)

  // Sort & filter state
  const [approvalFilter, setApprovalFilter] = useState<ApprovalFilter>('all')
  const [sortField, setSortField] = useState<SortField | null>(null)
  const [sortDir, setSortDir]     = useState<SortDir>('asc')

  const sendForApproval     = useSendForApproval()
  const updateQuotation     = useUpdateQuotation()
  const createOrderMutation = useCreateOrderFromQuotation()
  const deleteQuotation     = useDeleteQuotation()

  const sensors = useSensors(useSensor(PointerSensor))

  const isDraft            = quotation.status === 'draft'
  const isSentForApproval  = quotation.status === 'sent_for_approval'
  const isApproved         = quotation.status === 'approved'
  const isRejected         = quotation.status === 'rejected'
  const isConvertedToOrder = quotation.status === 'converted_to_order'

  const canEdit      = isDraft || isSentForApproval || isApproved
  const isDndEnabled = canEdit && sortField === null
  const hasApprovalData = isApproved || isSentForApproval

  const { data: relatedOrder } = useOrderByQuotationId(quotation.id, isConvertedToOrder)

  // Re-sync local state when quotation IDs change OR when item IDs change.
  // After save, the route DELETE+INSERT regenerates item IDs, so we react to
  // the items signature to keep localItems in sync with the refetched data.
  const itemsSignature = quotation.quotation_items.map((i) => i.id).join('|')

  // oxlint-disable-next-line react-doctor/no-cascading-set-state -- intentional pattern; structural refactor tracked separately
  useEffect(() => {
    // oxlint-disable-next-line react-doctor/no-derived-state -- intentional pattern; structural refactor tracked separately
    setLocalQuotationName(quotation.name)
    // oxlint-disable-next-line react-doctor/no-derived-state -- intentional pattern; structural refactor tracked separately
    setLocalName(quotation.customer_name)
    // oxlint-disable-next-line react-doctor/no-derived-state, react-doctor/no-pass-data-to-parent -- intentional pattern; structural refactor tracked separately
    setLocalItems(quotation.quotation_items.map(toItemRow))
    // oxlint-disable-next-line react-doctor/no-adjust-state-on-prop-change -- intentional pattern; structural refactor tracked separately
    setIsDirty(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quotation.id, itemsSignature]) // oxlint-disable-line react-doctor/exhaustive-deps -- intentional effect; refactor tracked separately

  // ── Item editing handlers ───────────────────────────────────────
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
      setLocalItems((prev) =>
        prev.map((item) => (item._id === id ? { ...item, ...data } : item))
      )
    } else {
      setLocalItems((prev) => [...prev, { ...data, _id: crypto.randomUUID() }])
    }
    setIsDirty(true)
  }

  const handleRemove = (id: string) => {
    setLocalItems((prev) => prev.filter((item) => item._id !== id))
    setIsDirty(true)
  }

  const handleAddSeparatorAfter = (afterId: string) => {
    const separator: QuotationItemRow = {
      _id:            crypto.randomUUID(),
      item_type:      'separator',
      section_label:  '',
      etm:            '',
      description:    '',
      description_es: '',
      model_code:     '',
      brand:          '',
      unit_price:     null,
      quantity:       null,
      delivery_time:  'immediate',
      _inDb:          false,
    }
    setLocalItems((prev) => {
      const idx = prev.findIndex((i) => i._id === afterId)
      if (idx === -1) return [...prev, separator]
      const next = [...prev]
      next.splice(idx + 1, 0, separator)
      return next
    })
    setIsDirty(true)
  }

  const handleSeparatorLabelChange = (id: string, label: string) => {
    setLocalItems((prev) =>
      prev.map((item) => item._id === id ? { ...item, section_label: label } : item)
    )
    setIsDirty(true)
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    setLocalItems((prev) => {
      const oldIndex = prev.findIndex((item) => item._id === active.id)
      const newIndex = prev.findIndex((item) => item._id === over.id)
      if (oldIndex === -1 || newIndex === -1) return prev
      const next = [...prev]
      const [moved] = next.splice(oldIndex, 1)
      next.splice(newIndex, 0, moved)
      return next
    })
    setIsDirty(true)
  }

  // ── Sort handler ────────────────────────────────────────────────
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortDir('asc')
    }
  }

  // ── Approval filter toggle (same pattern as orders page) ────────
  const handleFilterToggle = (key: ApprovalFilter) => {
    setApprovalFilter((prev) => (prev === key && key !== 'all' ? 'all' : key))
  }

  // ── Save changes ────────────────────────────────────────────────
  const handleSave = async () => {
    try {
      await updateQuotation.mutateAsync({
        id:            quotation.id,
        name:          localQuotationName,
        customer_name: localName,
        items:         localItems,
      })
      setIsDirty(false)
      toast.success('Cotización actualizada')
      refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al guardar')
    }
  }

  // ── Send for approval ───────────────────────────────────────────
  const handleSendForApproval = async () => {
    try {
      if (isDirty) {
        await updateQuotation.mutateAsync({
          id:            quotation.id,
          name:          localQuotationName,
          customer_name: localName,
          items:         localItems,
        })
        setIsDirty(false)
      }
      await sendForApproval.mutateAsync(quotation.id)
      toast.success('Cotización enviada a aprobación')
      refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al enviar')
    }
  }

  // ── Copy approval link ──────────────────────────────────────────
  const approvalUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/approve/${quotation.approval_token}`
    : ''

  const handleCopyLink = async () => {
    await navigator.clipboard.writeText(approvalUrl)
    setCopied(true)
    toast.success('Link copiado al portapapeles')
    setTimeout(() => setCopied(false), 2000)
  }

  // ── Create order from approved quotation ────────────────────────
  const handleCreateOrder = async () => {
    try {
      const result = await createOrderMutation.mutateAsync(quotation.id)
      toast.success(`Orden creada con ${result.items_count} producto(s)`)
      push(`/dashboard/orders/${result.order_id}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al generar la orden')
    }
  }

  const handleDeleteQuotation = async () => {
    try {
      await deleteQuotation.mutateAsync(quotation.id)
      toast.success('Cotización eliminada')
      push('/dashboard/quotations')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al eliminar la cotización')
    }
  }

  // ── Items, stats & derived display ─────────────────────────────
  const rawItems = canEdit ? localItems : quotation.quotation_items.map(toItemRow)
  const rawProductItems = rawItems.filter(isProductRow)
  const hasSeparators = rawItems.some((i) => i.item_type === 'separator')

  const partialTotal = calculateQuotationTotal(rawProductItems)

  const dbProductItems = quotation.quotation_items.filter(isProductRow)
  const approvedCount   = dbProductItems.filter((i) => i.is_approved === true).length
  const rejectedCount   = dbProductItems.filter((i) => i.is_approved === false).length
  const pendingCount    = dbProductItems.filter((i) => i.is_approved === null).length
  const noDataCount     = isDraft ? rawProductItems.filter(isMissingData).length : 0
  const noQuantityCount = isDraft ? rawProductItems.filter(isMissingQuantity).length : 0
  const totalCount      = isDraft
    ? rawProductItems.length
    : dbProductItems.length

  const canSendForApproval =
    localQuotationName.trim().length > 0 &&
    localName.trim().length > 0 &&
    localItems.some(isProductRow)

  // Filter by approval status — separators always pass through
  const filteredItems: QuotationItemRow[] =
    hasApprovalData && approvalFilter !== 'all'
      ? rawItems.filter((item) => {
          if (item.item_type === 'separator') return true
          const dbItem = quotation.quotation_items.find((i) => i.id === item._id)
          if (approvalFilter === 'approved') return dbItem?.is_approved === true
          if (approvalFilter === 'rejected') return dbItem?.is_approved === false
          if (approvalFilter === 'pending')  return dbItem?.is_approved === null
          return true
        })
      : rawItems

  // Sort — separators are excluded from sorting to preserve section structure
  const displayItems: QuotationItemRow[] = sortField && !hasSeparators
    ? filteredItems.toSorted((a, b) => {
        let aVal: number | string
        let bVal: number | string
        switch (sortField) {
          case 'description':
            aVal = (a.description || a.description_es || '').toLowerCase()
            bVal = (b.description || b.description_es || '').toLowerCase()
            break
          case 'unit_price':
            aVal = a.unit_price ?? -1
            bVal = b.unit_price ?? -1
            break
          case 'quantity':
            aVal = a.quantity ?? -1
            bVal = b.quantity ?? -1
            break
          case 'delivery_time':
            aVal = DELIVERY_ORDER[a.delivery_time] ?? 99
            bVal = DELIVERY_ORDER[b.delivery_time] ?? 99
            break
        }
        if (aVal < bVal) return sortDir === 'asc' ? -1 : 1
        if (aVal > bVal) return sortDir === 'asc' ? 1 : -1
        return 0
      })
    : filteredItems

  const totalCols =
    (canEdit ? 1 : 0) +
    7 +
    1 +
    (hasApprovalData ? 1 : 0) +
    (canEdit ? 1 : 0)

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => push('/dashboard/quotations')}>
          <ArrowLeft className="size-5" />
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">
              {canEdit ? localQuotationName || 'Sin nombre' : quotation.name || 'Sin nombre'}
            </h1>
            <QuotationStatusBadge status={quotation.status} />
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">
            {canEdit ? localName || 'Sin cliente' : quotation.customer_name} ·{' '}
            #{quotation.id.slice(0, 8)} · Creada el{' '}
            {new Date(quotation.created_at).toLocaleDateString('es-MX', {
              day: '2-digit', month: 'long', year: 'numeric',
            })}
          </p>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2">
          {canEdit && isDirty && (
            <Button
              variant="outline"
              onClick={handleSave}
              disabled={updateQuotation.isPending}
            >
              {updateQuotation.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
              Guardar cambios
            </Button>
          )}

          {isDraft && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button disabled={!canSendForApproval || sendForApproval.isPending || updateQuotation.isPending}>
                  <Send className="mr-2 size-4" />
                  Enviar a aprobación
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>¿Enviar a aprobación?</AlertDialogTitle>
                  <AlertDialogDescription>
                    {isDirty
                      ? 'Se guardarán los cambios pendientes y se enviará la cotización al aprobador.'
                      : 'Se enviará la cotización al aprobador. Una vez aprobada podrás seguir agregando o editando productos si es necesario.'}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction onClick={handleSendForApproval}>Sí, enviar</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}

          {isApproved && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  className="bg-green-600 hover:bg-green-700"
                  disabled={createOrderMutation.isPending}
                >
                  {createOrderMutation.isPending
                    ? <Loader2 className="mr-2 size-4 animate-spin" />
                    : <ShoppingCart className="mr-2 size-4" />}
                  Generar Orden
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>¿Generar orden de venta?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Se creará una orden con los{' '}
                    {quotation.quotation_items.filter((i) => i.is_approved === true).length}{' '}
                    productos aprobados. Se verificará el stock disponible y se descontará
                    automáticamente del inventario. Esta acción no se puede deshacer.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-green-600 hover:bg-green-700"
                    onClick={handleCreateOrder}
                  >
                    Sí, generar orden
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}

          {/* Delete — always available */}
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-9 text-destructive hover:text-destructive hover:bg-destructive/10"
                title="Eliminar cotización"
                disabled={deleteQuotation.isPending}
              >
                <Trash2 className="size-4" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>¿Eliminar esta cotización?</AlertDialogTitle>
                <AlertDialogDescription>
                  Se eliminará la cotización y todos sus productos permanentemente.
                  Esta acción no se puede deshacer.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  onClick={handleDeleteQuotation}
                >
                  Sí, eliminar
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      {/* Approval link banner */}
      {isSentForApproval && (
        <Card className="border-blue-200 bg-blue-50 dark:bg-blue-950/20 dark:border-blue-800">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-blue-800 dark:text-blue-300 mb-1">
                  Link de aprobación
                </p>
                <p className="text-xs text-blue-700 dark:text-blue-400 font-mono truncate">
                  {approvalUrl}
                </p>
              </div>
              <Button size="sm" variant="outline" onClick={handleCopyLink}>
                {copied ? <Check className="size-4 text-green-500" /> : <Copy className="size-4" />}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Rejected banner */}
      {isRejected && (
        <Card className="border-red-200 bg-red-50 dark:bg-red-950/20 dark:border-red-800">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2 text-red-800 dark:text-red-300">
              <AlertCircle className="size-4 shrink-0" />
              <p className="text-sm font-medium">
                Esta cotización fue rechazada por el cliente. Puedes crear una nueva con los ajustes necesarios.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Converted to order banner */}
      {isConvertedToOrder && (
        <Card className="border-green-200 bg-green-50 dark:bg-green-950/20 dark:border-green-800">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-green-800 dark:text-green-300">
                <CheckCircle2 className="size-4 shrink-0" />
                <p className="text-sm font-medium">
                  Esta cotización fue convertida a una orden de venta.
                </p>
              </div>
              {relatedOrder && (
                <Button
                  size="sm"
                  variant="outline"
                  asChild
                  className="border-green-300 text-green-800 dark:text-green-300 hover:bg-green-100 dark:hover:bg-green-900/40 shrink-0"
                >
                  <Link href={`/dashboard/orders/${relatedOrder.id}`}>
                    Ver orden
                    <ExternalLink className="ml-1.5 size-3.5" />
                  </Link>
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stats / Filter cards */}
      {hasApprovalData ? (
        /* Approval filter cards — clickable, same pattern as orders page */
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {/* Todos (acts as reset) */}
          <button type="button"
            onClick={() => handleFilterToggle('all')}
            className={`rounded-lg border p-4 text-left transition-colors cursor-pointer
              bg-card hover:bg-muted/50
              ${approvalFilter === 'all' ? 'ring-2 ring-offset-1 ring-border' : ''}`}
          >
            <p className="text-xs font-medium text-muted-foreground flex items-center gap-1 mb-2">
              <Package className="size-3" /> Todos
            </p>
            <p className="text-2xl font-bold">{totalCount}</p>
          </button>

          {/* Aprobados */}
          <button type="button"
            onClick={() => handleFilterToggle('approved')}
            className={`rounded-lg border p-4 text-left transition-colors cursor-pointer
              bg-green-50 hover:bg-green-100 dark:bg-green-900/30 dark:hover:bg-green-900/50
              ${approvalFilter === 'approved' ? 'ring-2 ring-offset-1 ring-green-400' : ''}`}
          >
            <p className="text-xs font-medium text-green-700 dark:text-green-300 flex items-center gap-1 mb-2">
              <CheckCircle2 className="size-3" /> Aprobados
            </p>
            <p className="text-2xl font-bold text-green-700 dark:text-green-300">{approvedCount}</p>
          </button>

          {/* Rechazados */}
          <button type="button"
            onClick={() => handleFilterToggle('rejected')}
            className={`rounded-lg border p-4 text-left transition-colors cursor-pointer
              bg-red-50 hover:bg-red-100 dark:bg-red-900/30 dark:hover:bg-red-900/50
              ${approvalFilter === 'rejected' ? 'ring-2 ring-offset-1 ring-red-400' : ''}`}
          >
            <p className="text-xs font-medium text-red-700 dark:text-red-300 flex items-center gap-1 mb-2">
              <XCircle className="size-3" /> Rechazados
            </p>
            <p className="text-2xl font-bold text-red-700 dark:text-red-300">{rejectedCount}</p>
          </button>

          {/* Pendientes */}
          <button type="button"
            onClick={() => handleFilterToggle('pending')}
            className={`rounded-lg border p-4 text-left transition-colors cursor-pointer
              bg-yellow-50 hover:bg-yellow-100 dark:bg-yellow-900/30 dark:hover:bg-yellow-900/50
              ${approvalFilter === 'pending' ? 'ring-2 ring-offset-1 ring-yellow-400' : ''}`}
          >
            <p className="text-xs font-medium text-yellow-700 dark:text-yellow-300 flex items-center gap-1 mb-2">
              <Clock className="size-3" /> Pendientes
            </p>
            <p className="text-2xl font-bold text-yellow-700 dark:text-yellow-300">{pendingCount}</p>
          </button>

          {/* Total (non-clickable) */}
          <Card>
            <CardContent className="pt-4 pb-4">
              <p className="text-xs text-muted-foreground">Total</p>
              <p className="text-xl font-bold">
                {partialTotal > 0
                  ? fmt(partialTotal)
                  : <span className="text-muted-foreground text-base">Sin precio</span>}
              </p>
            </CardContent>
          </Card>
        </div>
      ) : (
        /* Regular stats (draft / converted / rejected) */
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Card>
            <CardContent className="pt-4 pb-4">
              <p className="text-xs text-muted-foreground">Productos</p>
              <p className="text-2xl font-bold">{totalCount}</p>
            </CardContent>
          </Card>

          {canEdit && isDraft && (
            <>
              <Card className={noQuantityCount > 0 ? 'border-yellow-300 dark:border-yellow-700' : ''}>
                <CardContent className="pt-4 pb-4">
                  <p className="text-xs text-muted-foreground">Sin cantidad</p>
                  <p className={`text-2xl font-bold ${noQuantityCount > 0 ? 'text-yellow-600 dark:text-yellow-400' : 'text-muted-foreground'}`}>
                    {noQuantityCount}
                  </p>
                </CardContent>
              </Card>
              <Card className={noDataCount > 0 ? 'border-orange-300 dark:border-orange-700' : ''}>
                <CardContent className="pt-4 pb-4">
                  <p className="text-xs text-muted-foreground">Sin datos</p>
                  <p className={`text-2xl font-bold ${noDataCount > 0 ? 'text-orange-600 dark:text-orange-400' : 'text-muted-foreground'}`}>
                    {noDataCount}
                  </p>
                </CardContent>
              </Card>
            </>
          )}

          <Card>
            <CardContent className="pt-4 pb-4">
              <p className="text-xs text-muted-foreground">Total</p>
              <p className="text-xl font-bold">
                {partialTotal > 0
                  ? fmt(partialTotal)
                  : <span className="text-muted-foreground text-base">Sin precio</span>}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Name + Customer name inputs (editable quotations) */}
      {canEdit && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl">
          <div className="space-y-1.5">
            <Label htmlFor="quotation_name">
              Nombre de la cotización <span className="text-destructive">*</span>
            </Label>
            <Input
              id="quotation_name"
              value={localQuotationName}
              onChange={(e) => { setLocalQuotationName(e.target.value); setIsDirty(true) }}
              placeholder="Ej: Obra Norte Enero 2026"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="customer_name">
              Nombre del cliente <span className="text-destructive">*</span>
            </Label>
            <Input
              id="customer_name"
              value={localName}
              onChange={(e) => { setLocalName(e.target.value); setIsDirty(true) }}
              placeholder="Ej: Constructora ABC"
            />
          </div>
        </div>
      )}

      {/* Products section */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Package className="size-5" />
                Productos
              </CardTitle>
              {canEdit && (
                <CardDescription>
                  {isDraft
                    ? 'Agrega, edita o elimina productos antes de enviar a aprobación'
                    : isSentForApproval
                      ? 'Puedes editar precio, cantidad y entrega mientras el cliente revisa'
                      : 'Agrega o edita productos — los nuevos quedan aprobados automáticamente'}
                </CardDescription>
              )}
            </div>
            <div className="flex items-center gap-2">
              {sortField && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => { setSortField(null); setSortDir('asc') }}
                  className="text-muted-foreground h-8 px-2"
                >
                  <RotateCcw className="size-3.5 mr-1.5" />
                  Restablecer orden
                </Button>
              )}
              {canEdit && (
                <>
                  <Button size="sm" variant="outline" onClick={() => handleAddSeparatorAfter(localItems[localItems.length - 1]?._id ?? '')}>
                    <SeparatorHorizontal className="size-4 mr-1.5" />
                    Separador
                  </Button>
                  <Button size="sm" onClick={handleCreate}>
                    <Plus className="size-4 mr-1.5" />
                    Agregar
                  </Button>
                </>
              )}
            </div>
          </div>
        </CardHeader>

        <CardContent>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  {canEdit && <TableHead className="w-8" />}
                  <TableHead>ETM</TableHead>
                  <SortableHead col="description" currentSort={sortField} currentDir={sortDir} onSort={handleSort}>
                    Descripción
                  </SortableHead>
                  <TableHead>Código</TableHead>
                  <TableHead>Marca</TableHead>
                  <SortableHead col="unit_price" currentSort={sortField} currentDir={sortDir} onSort={handleSort} className="text-right">
                    Precio unit.
                  </SortableHead>
                  <SortableHead col="quantity" currentSort={sortField} currentDir={sortDir} onSort={handleSort} className="text-right">
                    Cant.
                  </SortableHead>
                  <TableHead className="text-right">Subtotal</TableHead>
                  <SortableHead col="delivery_time" currentSort={sortField} currentDir={sortDir} onSort={handleSort}>
                    Entrega
                  </SortableHead>
                  {hasApprovalData && (
                    <TableHead className="text-center">Aprobación</TableHead>
                  )}
                  {canEdit && (
                    <TableHead className="text-center">Acciones</TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={displayItems.map((i) => i._id)} strategy={verticalListSortingStrategy}>
                  <TableBody>
                    {displayItems.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={totalCols}
                          className="h-24 text-center text-sm text-muted-foreground"
                        >
                          {approvalFilter !== 'all'
                            ? 'No hay productos con ese estado de aprobación.'
                            : 'No hay productos en esta cotización.'}
                        </TableCell>
                      </TableRow>
                    ) : (
                      displayItems.map((item) =>
                        item.item_type === 'separator' ? (
                          <SortableSeparatorDetailRow
                            key={item._id}
                            item={item}
                            canEdit={canEdit}
                            isDndEnabled={isDndEnabled}
                            totalCols={totalCols}
                            onLabelChange={handleSeparatorLabelChange}
                            onRemove={handleRemove}
                          />
                        ) : (
                          <SortableDetailRow
                            key={item._id}
                            item={item}
                            canEdit={canEdit}
                            isDndEnabled={isDndEnabled}
                            isApproved={isApproved}
                            isSentForApproval={isSentForApproval}
                            dbItem={quotation.quotation_items.find((i) => i.id === item._id)}
                            onEdit={handleEdit}
                            onRemove={handleRemove}
                            onAddSeparatorAfter={handleAddSeparatorAfter}
                          />
                        )
                      )
                    )}
                  </TableBody>
                </SortableContext>
              </DndContext>

              {partialTotal > 0 && displayItems.length > 0 && (
                <TableFooter>
                  <TableRow>
                    <TableCell colSpan={canEdit ? 7 : 6} className="text-right font-bold">
                      Total:
                    </TableCell>
                    <TableCell className="text-right font-bold">
                      {fmt(partialTotal)}
                    </TableCell>
                    <TableCell /> {/* Entrega */}
                    {hasApprovalData && <TableCell />} {/* Aprobación */}
                    {canEdit && <TableCell />} {/* Acciones */}
                  </TableRow>
                </TableFooter>
              )}
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Product modal */}
      {canEdit && (
        <ProductModal
          mode={modalMode}
          item={selectedItem}
          open={modalOpen}
          onOpenChange={setModalOpen}
          onSave={handleModalSave}
        />
      )}

    </div>
  )
}
