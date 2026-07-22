'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  ArrowLeft,
  Download,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Package,
  PackageCheck,
  Truck,
  DollarSign,
  Plus,
  Pencil,
  Trash2,
  X,
  Check,
  ClipboardList,
  Info,
  SeparatorHorizontal,
} from '@/components/icons'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableFooter,
} from '@/components/ui/table'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { OrderStatusBadge } from './OrderStatusBadge'
import {
  useUpdateOrderStatus,
  useConfirmReception,
  useCancelOrder,
  useDeleteOrder,
  useAddOrderItem,
  useEditOrderItem,
  useEditDeliveryTime,
  useRemoveOrderItem,
  useUpdateOrderOdooId,
} from '@/hooks/useOrders'
import { useCurrency } from '@/hooks/useCurrency'
import { usePurchasePlan } from '@/hooks/usePurchasePlan'
import { useVisibleColumns, type TableColumn } from '@/hooks/useVisibleColumns'
import { ColumnPicker } from '@/components/ColumnPicker'
import {
  calculateDeliveredTotal,
  filterProductItems,
  receivedForCustomer,
  receptionExcess,
} from '@/lib/business-rules'
import type {
  OrderWithItems,
  OrderStatus,
  UrreaStatus,
  DeliveryTime,
  ConfirmReceptionResult,
} from '@/types/database'

const EMPTY_ADD_FORM = {
  etm: '',
  description: '',
  model_code: '',
  brand: '',
  unit_price: '',
  quantity_approved: '',
}

const DELIVERY_TIME_OPTIONS: { value: DeliveryTime; label: string }[] = [
  { value: 'immediate', label: 'Inmediato' },
  { value: '2_3_days', label: '2-3 días' },
  { value: '3_5_days', label: '3-5 días' },
  { value: '1_week', label: '1 semana' },
  { value: '2_weeks', label: '2 semanas' },
  { value: 'indefinite', label: 'Indefinido' },
]

const ORDER_STATUSES: { value: OrderStatus; label: string }[] = [
  { value: 'ordered',   label: 'Pedido' },
  { value: 'received',  label: 'Recibido' },
  { value: 'delivered', label: 'Entregado' },
  { value: 'completed', label: 'Completado' },
]


interface OrderDetailProps {
  order: OrderWithItems
}

interface ItemEdit {
  id: string
  quantity_received: number
  urrea_status: UrreaStatus
}

// oxlint-disable-next-line react-doctor/no-giant-component, react-doctor/prefer-useReducer -- intentional pattern; structural refactor tracked separately
export function OrderDetail({ order }: OrderDetailProps) {
  const { refresh, push } = useRouter()
  const fmt = useCurrency()
  const [itemEdits, setItemEdits] = useState<Record<string, ItemEdit>>({})

  // Add item dialog
  const [addItemOpen, setAddItemOpen] = useState(false)
  const [addForm, setAddForm] = useState(EMPTY_ADD_FORM)

  // Edit price per row
  const [editingPriceId, setEditingPriceId] = useState<string | null>(null)
  const [editingPrice, setEditingPrice] = useState('')

  // Delete confirmation
  const [deletingItemId, setDeletingItemId] = useState<string | null>(null)
  const [deleteOrderDialogOpen, setDeleteOrderDialogOpen] = useState(false)

  const updateStatus = useUpdateOrderStatus()
  const confirmReception = useConfirmReception()
  const cancelOrder = useCancelOrder()
  const deleteOrder = useDeleteOrder()
  const addOrderItem = useAddOrderItem()
  const editOrderItem = useEditOrderItem()
  const editDeliveryTime = useEditDeliveryTime()
  const removeOrderItem = useRemoveOrderItem()
  const updateOdooId = useUpdateOrderOdooId()

  // Odoo ID inline edit state
  const [editingOdooId, setEditingOdooId] = useState(false)
  const [odooIdValue, setOdooIdValue] = useState(order.odoo_id ?? '')

  const handleSaveOdooId = async () => {
    const trimmed = odooIdValue.trim()
    const newValue = trimmed === '' ? null : trimmed
    if (newValue === order.odoo_id) { setEditingOdooId(false); return }
    try {
      await updateOdooId.mutateAsync({ orderId: order.id, odoo_id: newValue })
      toast.success('ID de Odoo actualizado')
    } catch {
      toast.error('Error al guardar ID de Odoo')
    } finally {
      setEditingOdooId(false)
    }
  }

  const handleStatusChange = async (status: OrderStatus) => {
    try {
      await updateStatus.mutateAsync({ id: order.id, status })
      toast.success('Estado actualizado')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al actualizar estado')
    }
  }

  const [isDownloading, setIsDownloading] = useState(false)
  const [isDownloadingDelivery, setIsDownloadingDelivery] = useState(false)

  const handleDownloadDeliveryExcel = async () => {
    const deliveredItems = order.order_items.filter(
      (item) =>
        (!item.item_type || item.item_type === 'product') &&
        item.quantity_in_stock + receivedForCustomer(item) > 0
    )

    if (deliveredItems.length === 0) {
      toast.info('No hay productos surtidos para generar el formato de entrega')
      return
    }

    setIsDownloadingDelivery(true)
    try {
      // Carga diferida: xlsx solo baja al descargar el formato de entrega.
      const { generateDeliveryExcel, downloadDeliveryExcel } = await import('@/lib/excel/generator')
      const blob = generateDeliveryExcel(order.order_items, order.customer_name)
      downloadDeliveryExcel(blob, order.customer_name)
      toast.success(`Formato de entrega descargado (${deliveredItems.length} productos)`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al generar formato de entrega')
    } finally {
      setIsDownloadingDelivery(false)
    }
  }

  // El Excel URREA sale de las decisiones GUARDADAS del planificador (ADR-018):
  // piezas = paquetes × STD, criterio = pertenencia al catálogo (ya no brand).
  const { data: planData } = usePurchasePlan(order.id)
  const plan = planData?.plan
  const wholesaleRows = (plan?.groups ?? [])
    .filter((g) => g.decision && g.decision.packages_wholesale > 0)
    .map((g) => ({
      code: g.decision!.model_code,
      pieces: g.decision!.packages_wholesale * g.decision!.std_snapshot,
    }))

  const [staleDialogOpen, setStaleDialogOpen] = useState(false)

  const generateUrrea = async () => {
    if (wholesaleRows.length === 0) {
      toast.info('Ninguna decisión manda piezas a URREA (todo quedó en menudeo o stock)')
      return
    }
    setIsDownloading(true)
    try {
      // Carga diferida: xlsx/jszip solo bajan al generar el pedido URREA.
      const { generateUrreaOrderExcel, downloadUrreaOrder } = await import('@/lib/excel/generator')
      const blob = await generateUrreaOrderExcel(wholesaleRows)
      downloadUrreaOrder(blob, order.customer_name)
      toast.success(`Excel de pedido URREA descargado (${wholesaleRows.length} productos)`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al generar pedido URREA')
    } finally {
      setIsDownloading(false)
    }
  }

  const handleDownloadUrreaOrder = async () => {
    // Sin decisiones guardadas no hay pedido que armar → llevar al planificador.
    if (!plan || plan.summary.decided === 0) {
      toast.info('Primero planifica la compra (mayoreo vs menudeo)')
      push(`/dashboard/orders/${order.id}/planner`)
      return
    }
    // Decisiones desactualizadas: avisar antes de generar con múltiplos viejos.
    if (plan.summary.stale > 0) {
      setStaleDialogOpen(true)
      return
    }
    await generateUrrea()
  }

  const handleItemEdit = (itemId: string, field: keyof ItemEdit, value: number | UrreaStatus) => {
    setItemEdits((prev) => ({
      ...prev,
      [itemId]: {
        id: itemId,
        quantity_received:
          prev[itemId]?.quantity_received ??
          order.order_items.find((i) => i.id === itemId)?.quantity_received ??
          0,
        urrea_status:
          prev[itemId]?.urrea_status ??
          order.order_items.find((i) => i.id === itemId)?.urrea_status ??
          'pending',
        [field]: value,
      },
    }))
  }

  // ── Recepción con confirmación (anti-dedazo, ADR-019) ──────────────
  // El botón abre un resumen de lo capturado; la mutación solo corre al
  // confirmar en el diálogo. Sin tope en el input, un typo (100 vs 10)
  // mandaría excedente fantasma al inventario en silencio.
  const [receptionDialogOpen, setReceptionDialogOpen] = useState(false)

  /** Filas del resumen: edición + datos del ítem para mostrar el efecto. */
  const receptionSummary = Object.values(itemEdits).flatMap((edit) => {
    const item = order.order_items.find((i) => i.id === edit.id)
    if (!item) return []
    const excess = receptionExcess({
      quantity_received: edit.quantity_received,
      quantity_to_order: item.quantity_to_order,
    })
    return [{
      id: item.id,
      etm: item.etm || item.model_code,
      ordered: item.quantity_to_order,
      received: edit.quantity_received,
      excess,
      // Dedazo probable: recibir más del doble de lo pedido
      suspicious: item.quantity_to_order > 0 && edit.quantity_received > item.quantity_to_order * 2,
    }]
  })
  const totalExcess = receptionSummary.reduce((sum, row) => sum + row.excess, 0)

  const handleConfirmReception = () => {
    if (Object.values(itemEdits).length === 0) {
      toast.error('No hay cambios para confirmar')
      return
    }
    setReceptionDialogOpen(true)
  }

  const executeConfirmReception = async () => {
    setReceptionDialogOpen(false)
    try {
      const result: ConfirmReceptionResult = await confirmReception.mutateAsync({
        orderId: order.id,
        input: { items: Object.values(itemEdits) },
      })
      toast.success('Recepción confirmada')
      result.warnings?.forEach((warning) => toast.warning(warning))
      setItemEdits({})
      refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al confirmar recepción')
    }
  }

  const handleAddItem = async () => {
    const qty = parseInt(addForm.quantity_approved)
    const price = parseFloat(addForm.unit_price)

    if (!qty || qty < 1) { toast.error('La cantidad debe ser mayor a 0'); return }
    if (isNaN(price) || price < 0) { toast.error('El precio no puede ser negativo'); return }

    try {
      await addOrderItem.mutateAsync({
        orderId: order.id,
        item: {
          etm:               addForm.etm.trim(),
          description:       addForm.description.trim(),
          model_code:        addForm.model_code.trim(),
          brand:             addForm.brand.trim(),
          unit_price:        price,
          quantity_approved: qty,
        },
      })
      toast.success('Producto agregado')
      setAddForm(EMPTY_ADD_FORM)
      setAddItemOpen(false)
      refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al agregar el producto')
    }
  }

  const handleStartEditPrice = (itemId: string, currentPrice: number) => {
    setEditingPriceId(itemId)
    setEditingPrice(String(currentPrice))
  }

  const handleSavePrice = async (itemId: string) => {
    const price = parseFloat(editingPrice)
    if (isNaN(price) || price < 0) { toast.error('Precio inválido'); return }

    try {
      await editOrderItem.mutateAsync({ orderId: order.id, itemId, unit_price: price })
      toast.success('Precio actualizado')
      setEditingPriceId(null)
      refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al actualizar el precio')
    }
  }

  const handleRemoveItem = async () => {
    if (!deletingItemId) return
    try {
      await removeOrderItem.mutateAsync({ orderId: order.id, itemId: deletingItemId })
      toast.success('Producto eliminado')
      setDeletingItemId(null)
      refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al eliminar el producto')
    }
  }

  const handleDeliveryTimeChange = async (itemId: string, delivery_time: DeliveryTime) => {
    try {
      await editDeliveryTime.mutateAsync({ orderId: order.id, itemId, delivery_time })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al actualizar tiempo de entrega')
    }
  }

  const handleCancelOrder = async () => {
    try {
      await cancelOrder.mutateAsync(order.id)
      toast.success('Orden cancelada')
      refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al cancelar orden')
    }
  }

  const handleDeleteOrder = async () => {
    try {
      await deleteOrder.mutateAsync(order.id)
      setDeleteOrderDialogOpen(false)
      toast.success('Orden eliminada')
      push('/dashboard/orders')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al eliminar la orden')
    }
  }

  const hasChanges = Object.keys(itemEdits).length > 0

  // Columnas de la tabla de ítems (issue #18). Acciones solo entra a las defs
  // con la orden abierta; ETM y Acciones son fijas.
  const isOrderActive = order.status !== 'completed' && order.status !== 'cancelled'
  const itemColumns = useMemo<TableColumn[]>(() => [
    { id: 'etm', label: 'ETM', hideable: false },
    { id: 'model_code', label: 'Model Code' },
    { id: 'brand', label: 'Marca' },
    { id: 'description', label: 'Descripción' },
    { id: 'qty_approved', label: 'Aprobados' },
    { id: 'qty_in_stock', label: 'En Stock' },
    { id: 'location', label: 'Ubicación' },
    { id: 'qty_to_order', label: 'A Pedir' },
    { id: 'qty_received', label: 'Recibidos' },
    { id: 'urrea_status', label: 'Estado de envío' },
    { id: 'delivery', label: 'Tiempo Entrega' },
    { id: 'unit_price', label: 'Precio' },
    { id: 'total', label: 'Total' },
    ...(isOrderActive ? [{ id: 'actions', label: 'Acciones', hideable: false }] : []),
  ], [isOrderActive])
  const cols = useVisibleColumns('order-detail-items', itemColumns)
  const isCancelled = order.status === 'cancelled'
  const isCompleted = order.status === 'completed'

  const totalAmount = order.total_amount

  return (
    <div className="space-y-6">

      {/* Header. flex-wrap + min-w del título: las acciones (5+ botones) son
          shrink-0 — sin wrap, en pantallas medianas exprimían el título a una
          columna de letras; ahora bajan a su propia línea. */}
      <div className="flex items-start gap-4 flex-wrap">
        <Button
          variant="ghost"
          size="icon"
          className="mt-0.5 shrink-0"
          onClick={() => push('/dashboard/orders')}
        >
          <ArrowLeft className="size-5" />
        </Button>
        <div className="flex-1 min-w-72">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-semibold tracking-tight">
              {order.name || order.customer_name}
            </h1>
            <OrderStatusBadge status={order.status} />
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">
            {order.name ? `${order.customer_name} · ` : ''}#{order.id.slice(0, 8)} · Creada el{' '}
            {new Date(order.created_at).toLocaleDateString('es-MX', {
              day: '2-digit',
              month: 'long',
              year: 'numeric',
            })}
          </p>

          {/* Odoo ID inline edit */}
          <div className="flex items-center gap-2 mt-2">
            <span className="text-xs font-medium text-muted-foreground shrink-0">Odoo ID:</span>
            {editingOdooId ? (
              <div className="flex items-center gap-2">
                <Input
                  autoFocus
                  value={odooIdValue}
                  onChange={(e) => setOdooIdValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSaveOdooId()
                    if (e.key === 'Escape') { setEditingOdooId(false); setOdooIdValue(order.odoo_id ?? '') }
                  }}
                  className="h-8 w-44 text-sm font-mono"
                  placeholder="ej. FAC-001"
                />
                <Button
                  size="sm"
                  className="h-8"
                  disabled={updateOdooId.isPending}
                  onClick={handleSaveOdooId}
                >
                  {updateOdooId.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Guardar'}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8"
                  onClick={() => { setEditingOdooId(false); setOdooIdValue(order.odoo_id ?? '') }}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ) : (
              <button
                onClick={() => { setOdooIdValue(order.odoo_id ?? ''); setEditingOdooId(true) }}
                className="flex items-center gap-1.5 text-sm rounded px-2 py-0.5 border border-transparent hover:border-border hover:bg-muted transition-colors"
              >
                {order.odoo_id
                  ? <span className="font-mono">{order.odoo_id}</span>
                  : <span className="text-muted-foreground italic text-xs">Sin ID de Odoo</span>
                }
                <Pencil className="h-3 w-3 text-muted-foreground" />
              </button>
            )}
          </div>
        </div>

        {/* Actions — ml-auto: alineadas a la derecha también cuando bajan de línea */}
        <div className="flex items-center gap-2 flex-wrap justify-end shrink-0 ml-auto">
          {!isCancelled && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Estado:</span>
              <Select
                value={order.status}
                onValueChange={(value) => handleStatusChange(value as OrderStatus)}
                disabled={updateStatus.isPending}
              >
                <SelectTrigger className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ORDER_STATUSES.map((status) => (
                    <SelectItem key={status.value} value={status.value}>
                      {status.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <Button
            variant="outline"
            onClick={() => push(`/dashboard/orders/${order.id}/planner`)}
          >
            <ClipboardList className="mr-2 size-4" />
            Planificar compra
          </Button>

          <Button
            variant="outline"
            onClick={handleDownloadUrreaOrder}
            disabled={isDownloading}
          >
            {isDownloading ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <Download className="mr-2 size-4" />
            )}
            Pedido URREA{plan ? ` (${wholesaleRows.length})` : ''}
          </Button>

          <Button
            variant="outline"
            onClick={handleDownloadDeliveryExcel}
            disabled={isDownloadingDelivery}
          >
            {isDownloadingDelivery ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <Download className="mr-2 size-4" />
            )}
            Formato de Entrega
          </Button>

          {!isCancelled && !isCompleted && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="outline"
                  disabled={cancelOrder.isPending}
                  className="border-destructive text-destructive hover:bg-destructive hover:text-white gap-1.5 transition-colors"
                >
                  <AlertTriangle className="size-4" strokeWidth={2.5} />
                  Cancelar Orden
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>¿Cancelar esta orden?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Esta acción devolverá el inventario apartado y marcará la orden como
                    cancelada. Esta acción no se puede deshacer.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>No, mantener</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleCancelOrder}
                    className="bg-destructive text-destructive-foreground"
                  >
                    Sí, cancelar orden
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}

          {/* Delete — always available */}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-9 text-destructive hover:text-destructive hover:bg-destructive/10"
            title="Eliminar orden"
            onClick={() => setDeleteOrderDialogOpen(true)}
          >
            <Trash2 className="size-4" />
          </Button>
          <AlertDialog
            open={deleteOrderDialogOpen}
            onOpenChange={(o) => { if (!o && !deleteOrder.isPending) setDeleteOrderDialogOpen(false) }}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>¿Eliminar esta orden?</AlertDialogTitle>
                <AlertDialogDescription>
                  Se eliminará la orden y todos sus ítems permanentemente. Si tenía stock
                  descontado del inventario, será restaurado automáticamente.
                  Esta acción no se puede deshacer.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={deleteOrder.isPending}>Cancelar</AlertDialogCancel>
                <Button
                  type="button"
                  variant="destructive"
                  onClick={handleDeleteOrder}
                  disabled={deleteOrder.isPending}
                >
                  {deleteOrder.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
                  Sí, eliminar
                </Button>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      {/* Cancelled banner */}
      {isCancelled && (
        <Card className="border-red-200 bg-red-50 dark:bg-red-950/20 dark:border-red-800">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2 text-red-800 dark:text-red-300">
              <XCircle className="size-4 shrink-0" />
              <p className="text-sm font-medium">
                Esta orden fue cancelada. El inventario apartado ha sido restaurado.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Completed banner */}
      {isCompleted && (
        <Card className="border-green-200 bg-green-50 dark:bg-green-950/20 dark:border-green-800">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2 text-green-800 dark:text-green-300">
              <CheckCircle2 className="size-4 shrink-0" />
              <p className="text-sm font-medium">Esta orden está completada.</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Info notes — only when order is active */}
      {!isCancelled && !isCompleted && (
        <div className="flex flex-col gap-1.5 text-xs text-muted-foreground px-1">
          <div className="flex items-start gap-1.5">
            <Info className="size-3.5 mt-0.5 shrink-0" />
            <span>
              <strong>Pedido URREA:</strong> el Excel se genera con las decisiones de mayoreo
              guardadas en <em>Planificar compra</em> (piezas = paquetes × STD). Aplica a
              cualquier producto del catálogo URREA (todas sus líneas); lo decidido a menudeo y
              lo que no está en el catálogo va en la lista de compra local.
            </span>
          </div>
          <div className="flex items-start gap-1.5">
            <Info className="size-3.5 mt-0.5 shrink-0" />
            <span>
              <strong>Estado de envío / Recibidos:</strong> solo es editable en productos con{' '}
              <em>A Pedir &gt; 0</em>. Los productos cubiertos completamente por stock aparecen
              fijos como <em>En stock</em>.
            </span>
          </div>
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-lg border p-4 bg-card">
          <p className="text-xs font-medium text-muted-foreground flex items-center gap-1 mb-2">
            <Package className="size-3" /> Productos
          </p>
          {/* REGLA: separadores fuera de los conteos — contaba order_items.length. */}
          <p className="text-2xl font-bold">{filterProductItems(order.order_items).length}</p>
        </div>
        <div className="rounded-lg border p-4 bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800">
          <p className="text-xs font-medium text-blue-700 dark:text-blue-300 flex items-center gap-1 mb-2">
            <PackageCheck className="size-3" /> En Stock
          </p>
          <p className="text-2xl font-bold text-blue-700 dark:text-blue-300">
            {order.order_items.reduce((sum, item) => sum + item.quantity_in_stock, 0)}
          </p>
        </div>
        <div className="rounded-lg border p-4 bg-orange-50 dark:bg-orange-950/20 border-orange-200 dark:border-orange-800">
          <p className="text-xs font-medium text-orange-700 dark:text-orange-300 flex items-center gap-1 mb-2">
            <Truck className="size-3" /> A Pedir
          </p>
          <p className="text-2xl font-bold text-orange-700 dark:text-orange-300">
            {order.order_items.reduce((sum, item) => sum + item.quantity_to_order, 0)}
          </p>
        </div>
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-xs text-muted-foreground flex items-center gap-1 mb-2">
              <DollarSign className="size-3" /> Total
            </p>
            <p className="text-xl font-bold">
              {fmt(totalAmount)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Order Items */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Package className="size-5" />
                Productos
              </CardTitle>
              {!isCompleted && !isCancelled && (
                <CardDescription>
                  Edita precios, agrega o elimina productos, y registra las cantidades recibidas
                </CardDescription>
              )}
            </div>
            <div className="flex items-center gap-2">
              <ColumnPicker tableId="order-detail-items" columns={itemColumns} />
              {!isCompleted && !isCancelled && (
                <Button size="sm" variant="outline" onClick={() => setAddItemOpen(true)}>
                  <Plus className="size-4 mr-1.5" />
                  Agregar
                </Button>
              )}
              {!isCompleted && !isCancelled && hasChanges && (
                <Button onClick={handleConfirmReception} disabled={confirmReception.isPending}>
                  {confirmReception.isPending ? (
                    <Loader2 className="mr-2 size-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="mr-2 size-4" />
                  )}
                  Confirmar Recepción
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ETM</TableHead>
                  {cols.isVisible('model_code') && <TableHead>Model Code</TableHead>}
                  {cols.isVisible('brand') && <TableHead>Marca</TableHead>}
                  {cols.isVisible('description') && <TableHead className="max-w-[200px]">Descripción</TableHead>}
                  {cols.isVisible('qty_approved') && <TableHead className="text-right">Aprobados</TableHead>}
                  {cols.isVisible('qty_in_stock') && <TableHead className="text-right">En Stock</TableHead>}
                  {cols.isVisible('location') && <TableHead>Ubicación</TableHead>}
                  {cols.isVisible('qty_to_order') && <TableHead className="text-right">A Pedir</TableHead>}
                  {cols.isVisible('qty_received') && <TableHead className="text-right">Recibidos</TableHead>}
                  {cols.isVisible('urrea_status') && <TableHead>Estado de envío</TableHead>}
                  {cols.isVisible('delivery') && <TableHead>Tiempo Entrega</TableHead>}
                  {cols.isVisible('unit_price') && <TableHead className="text-right">Precio</TableHead>}
                  {cols.isVisible('total') && <TableHead className="text-right">Total</TableHead>}
                  {!isCompleted && !isCancelled && (
                    <TableHead className="text-center">Acciones</TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {order.order_items.map((item) => {
                  // Render separator as a visual divider
                  if (item.item_type === 'separator') {
                    return (
                      <TableRow key={item.id} className="border-b border-dashed border-border/60 bg-muted/30 hover:bg-muted/30">
                        <TableCell colSpan={cols.visibleCount} className="px-4 py-2">
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <SeparatorHorizontal className="size-3.5 shrink-0" />
                            <span className="font-medium">{item.section_label || 'Sección'}</span>
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  }

                  const edit = itemEdits[item.id]
                  const isOrderOpen = !isCompleted && !isCancelled
                  const hasUrreaOrder = item.quantity_to_order > 0
                  const canEditQuantity = isOrderOpen && hasUrreaOrder
                  const canEditUrreaStatus = isOrderOpen && hasUrreaOrder

                  return (
                    <TableRow key={item.id}>
                      <TableCell className="font-mono text-sm">{item.etm}</TableCell>
                      {cols.isVisible('model_code') && <TableCell>{item.model_code}</TableCell>}
                      {cols.isVisible('brand') && <TableCell>{item.brand || '—'}</TableCell>}
                      {cols.isVisible('description') && (
                        <TableCell className="max-w-[200px] text-sm break-words whitespace-normal">
                          {item.description}
                        </TableCell>
                      )}
                      {cols.isVisible('qty_approved') && (
                        <TableCell className="text-right">{item.quantity_approved}</TableCell>
                      )}
                      {cols.isVisible('qty_in_stock') && (
                        <TableCell className="text-right text-blue-600">
                          {item.quantity_in_stock}
                        </TableCell>
                      )}
                      {cols.isVisible('location') && (
                        <TableCell className="font-mono text-sm">
                          {item.quantity_in_stock > 0 && item.location
                            ? item.location
                            : <span className="text-muted-foreground">{'—'}</span>}
                        </TableCell>
                      )}
                      {cols.isVisible('qty_to_order') && (
                        <TableCell className="text-right text-orange-600">
                          {item.quantity_to_order}
                        </TableCell>
                      )}
                      {cols.isVisible('qty_received') && (
                      <TableCell className="text-right">
                        {canEditQuantity ? (() => {
                          const effectiveReceived = edit?.quantity_received ?? item.quantity_received
                          const excess = receptionExcess({
                            quantity_received: effectiveReceived,
                            quantity_to_order: item.quantity_to_order,
                          })
                          return (
                            <div className="flex flex-col items-end">
                              <Input
                                type="number"
                                min="0"
                                className="w-20 h-8 text-right"
                                value={effectiveReceived}
                                onChange={(e) =>
                                  handleItemEdit(
                                    item.id,
                                    'quantity_received',
                                    parseInt(e.target.value) || 0
                                  )
                                }
                              />
                              {excess > 0 && (
                                <span className="text-xs text-blue-600 dark:text-blue-400 mt-0.5">
                                  +{excess} a tienda
                                </span>
                              )}
                            </div>
                          )
                        })() : (
                          <span className="text-green-600">
                            {item.quantity_received}
                            {receptionExcess(item) > 0 && (
                              <span className="block text-xs text-blue-600 dark:text-blue-400">
                                +{receptionExcess(item)} a tienda
                              </span>
                            )}
                          </span>
                        )}
                      </TableCell>
                      )}
                      {cols.isVisible('urrea_status') && (
                      <TableCell>
                        {canEditUrreaStatus ? (
                          <Select
                            value={edit?.urrea_status ?? item.urrea_status}
                            onValueChange={(value) =>
                              handleItemEdit(item.id, 'urrea_status', value as UrreaStatus)
                            }
                          >
                            <SelectTrigger className="w-32 h-8">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="pending">Pendiente</SelectItem>
                              <SelectItem value="supplied">Surtido</SelectItem>
                              <SelectItem value="not_supplied">No surtido</SelectItem>
                            </SelectContent>
                          </Select>
                        ) : !hasUrreaOrder ? (
                          <Badge variant="outline" className="text-xs text-blue-600 border-blue-300 dark:text-blue-400 dark:border-blue-700">
                            En stock
                          </Badge>
                        ) : item.urrea_status === 'supplied' ? (
                          <Badge variant="outline" className="text-xs text-green-600 border-green-300 dark:text-green-400 dark:border-green-700">
                            Surtido
                          </Badge>
                        ) : item.urrea_status === 'not_supplied' ? (
                          <Badge variant="outline" className="text-xs text-red-600 border-red-300 dark:text-red-400 dark:border-red-700">
                            No surtido
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-xs text-yellow-600 border-yellow-300 dark:text-yellow-400 dark:border-yellow-700">
                            Pendiente
                          </Badge>
                        )}
                      </TableCell>
                      )}
                      {cols.isVisible('delivery') && (
                      <TableCell>
                        {isOrderOpen ? (
                          <Select
                            value={item.delivery_time}
                            onValueChange={(value) =>
                              handleDeliveryTimeChange(item.id, value as DeliveryTime)
                            }
                            disabled={editDeliveryTime.isPending}
                          >
                            <SelectTrigger className="w-32 h-8">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {DELIVERY_TIME_OPTIONS.map((opt) => (
                                <SelectItem key={opt.value} value={opt.value}>
                                  {opt.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <span>
                            {DELIVERY_TIME_OPTIONS.find((o) => o.value === item.delivery_time)?.label ?? 'Inmediato'}
                          </span>
                        )}
                      </TableCell>
                      )}
                      {cols.isVisible('unit_price') && (
                      <TableCell className="text-right">
                        {isOrderOpen && editingPriceId === item.id ? (
                          <div className="flex items-center justify-end gap-1">
                            <Input
                              type="number"
                              step="0.01"
                              min="0"
                              className="w-24 h-8 text-right"
                              value={editingPrice}
                              onChange={(e) => setEditingPrice(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleSavePrice(item.id)
                                if (e.key === 'Escape') setEditingPriceId(null)
                              }}
                              autoFocus
                            />
                            <Button
                              size="icon" variant="ghost" className="size-7 text-green-600"
                              onClick={() => handleSavePrice(item.id)}
                              disabled={editOrderItem.isPending}
                            >
                              <Check className="size-3.5" />
                            </Button>
                            <Button
                              size="icon" variant="ghost" className="size-7"
                              onClick={() => setEditingPriceId(null)}
                            >
                              <X className="size-3.5" />
                            </Button>
                          </div>
                        ) : (
                          <span>{fmt(item.unit_price)}</span>
                        )}
                      </TableCell>
                      )}
                      {cols.isVisible('total') && (
                        <TableCell className="text-right font-medium">
                          {/* Total de línea con la misma regla del backend (excedente no se factura) */}
                          {fmt(calculateDeliveredTotal([item]))}
                        </TableCell>
                      )}
                      {isOrderOpen && (
                        <TableCell>
                          <div className="flex items-center justify-center gap-1">
                            <Button
                              size="icon" variant="ghost" className="size-7"
                              onClick={() => handleStartEditPrice(item.id, item.unit_price)}
                              title="Editar precio"
                            >
                              <Pencil className="size-3.5" />
                            </Button>
                            <Button
                              size="icon" variant="ghost"
                              className="size-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                              onClick={() => setDeletingItemId(item.id)}
                              title="Eliminar producto"
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  )
                })}
              </TableBody>
              <TableFooter>
                <TableRow>
                  {(() => {
                    // Alineado a las columnas VISIBLES; si Total está oculta,
                    // una sola celda fusionada con el monto.
                    const totalIdx = cols.visibleColumns.findIndex((c) => c.id === 'total')
                    if (totalIdx < 0) {
                      return (
                        <TableCell colSpan={cols.visibleCount} className="text-right font-bold">
                          Total: {fmt(totalAmount)}
                        </TableCell>
                      )
                    }
                    return (
                      <>
                        <TableCell colSpan={totalIdx} className="text-right font-bold">
                          Total:
                        </TableCell>
                        <TableCell className="text-right font-bold">
                          {fmt(totalAmount)}
                        </TableCell>
                        {cols.visibleColumns.slice(totalIdx + 1).map((c) => (
                          <TableCell key={c.id} />
                        ))}
                      </>
                    )
                  })()}
                </TableRow>
              </TableFooter>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Add item dialog */}
      <Dialog open={addItemOpen} onOpenChange={(o) => { setAddItemOpen(o); if (!o) setAddForm(EMPTY_ADD_FORM) }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Agregar producto a la orden</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="add-etm">ETM</Label>
                <Input
                  id="add-etm"
                  placeholder="Ej: H7-ET400"
                  value={addForm.etm}
                  onChange={(e) => setAddForm((f) => ({ ...f, etm: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="add-model">Código Modelo</Label>
                <Input
                  id="add-model"
                  placeholder="Ej: 95040"
                  value={addForm.model_code}
                  onChange={(e) => setAddForm((f) => ({ ...f, model_code: e.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="add-desc">Descripción</Label>
              <Input
                id="add-desc"
                placeholder="Descripción del producto"
                value={addForm.description}
                onChange={(e) => setAddForm((f) => ({ ...f, description: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="add-brand">Marca</Label>
                <Input
                  id="add-brand"
                  placeholder="URREA"
                  value={addForm.brand}
                  onChange={(e) => setAddForm((f) => ({ ...f, brand: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="add-price">Precio <span className="text-destructive">*</span></Label>
                <Input
                  id="add-price"
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0.00"
                  value={addForm.unit_price}
                  onChange={(e) => setAddForm((f) => ({ ...f, unit_price: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="add-qty">Cantidad <span className="text-destructive">*</span></Label>
                <Input
                  id="add-qty"
                  type="number"
                  min="1"
                  step="1"
                  placeholder="0"
                  value={addForm.quantity_approved}
                  onChange={(e) => setAddForm((f) => ({ ...f, quantity_approved: e.target.value }))}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddItemOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleAddItem} disabled={addOrderItem.isPending}>
              {addOrderItem.isPending ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
              Agregar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation dialog */}
      <AlertDialog open={!!deletingItemId} onOpenChange={(o) => { if (!o) setDeletingItemId(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar este producto?</AlertDialogTitle>
            <AlertDialogDescription>
              Se eliminará el producto de la orden y se restaurará el inventario apartado.
              Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeletingItemId(null)}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground"
              onClick={handleRemoveItem}
              disabled={removeOrderItem.isPending}
            >
              {removeOrderItem.isPending ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
              Sí, eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Resumen de recepción antes de confirmar (anti-dedazo, ADR-019) */}
      <AlertDialog open={receptionDialogOpen} onOpenChange={setReceptionDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar recepción</AlertDialogTitle>
            <AlertDialogDescription>
              Revisa las cantidades capturadas antes de aplicarlas
              {totalExcess > 0
                ? ` — ${totalExcess} pieza${totalExcess !== 1 ? 's' : ''} de excedente entrará${totalExcess !== 1 ? 'n' : ''} al inventario de tienda.`
                : '.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="rounded-md border max-h-64 overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ETM</TableHead>
                  <TableHead className="text-right">Pedido</TableHead>
                  <TableHead className="text-right">Recibido</TableHead>
                  <TableHead className="text-right">Inventario</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {receptionSummary.map((row) => (
                  <TableRow
                    key={row.id}
                    className={row.excess > 0 ? 'bg-amber-500/10' : undefined}
                  >
                    <TableCell className="font-mono text-sm">{row.etm}</TableCell>
                    <TableCell className="text-right">{row.ordered}</TableCell>
                    <TableCell className="text-right font-medium">
                      {row.received}
                      {row.suspicious && (
                        <AlertTriangle className="inline size-3.5 ml-1 text-amber-600" aria-label="Cantidad inusual" />
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {row.excess > 0 ? (
                        <span className="text-blue-600 dark:text-blue-400">+{row.excess} a tienda</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {receptionSummary.some((row) => row.suspicious) && (
            <p className="text-xs text-amber-600 flex items-center gap-1.5">
              <AlertTriangle className="size-3.5 shrink-0" />
              Hay cantidades que superan por mucho lo pedido — verifica que no sea un error de captura.
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Revisar de nuevo</AlertDialogCancel>
            <AlertDialogAction
              onClick={executeConfirmReception}
              disabled={confirmReception.isPending}
            >
              Sí, confirmar recepción
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Aviso de decisiones de compra desactualizadas (ADR-018) */}
      <AlertDialog open={staleDialogOpen} onOpenChange={setStaleDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hay decisiones de compra desactualizadas</AlertDialogTitle>
            <AlertDialogDescription>
              Cambiaron las cantidades a pedir o el STD del catálogo desde que se planificó la
              compra. Puedes generar el Excel con las decisiones guardadas o revisar el
              planificador primero.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => push(`/dashboard/orders/${order.id}/planner`)}>
              Ir al planificador
            </AlertDialogCancel>
            <AlertDialogAction onClick={() => { setStaleDialogOpen(false); void generateUrrea() }}>
              Generar de todos modos
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
