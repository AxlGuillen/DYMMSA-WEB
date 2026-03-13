'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  Download,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Package,
  Plus,
  Pencil,
  Trash2,
  X,
  Check,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
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
import { generateUrreaOrderExcel, downloadUrreaOrder } from '@/lib/excel/generator'
import {
  useUpdateOrderStatus,
  useConfirmReception,
  useCancelOrder,
  useAddOrderItem,
  useEditOrderItem,
  useEditDeliveryTime,
  useRemoveOrderItem,
} from '@/hooks/useOrders'
import type { OrderWithItems, OrderStatus, UrreaStatus, DeliveryTime } from '@/types/database'

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
  { value: 'pending_urrea_order', label: 'Pendiente URREA' },
  { value: 'received_from_urrea', label: 'Recibido URREA' },
  { value: 'pending_payment', label: 'Pendiente Pago' },
  { value: 'paid', label: 'Pagado' },
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

export function OrderDetail({ order }: OrderDetailProps) {
  const router = useRouter()
  const [itemEdits, setItemEdits] = useState<Record<string, ItemEdit>>({})

  // Add item dialog
  const [addItemOpen, setAddItemOpen] = useState(false)
  const [addForm, setAddForm] = useState(EMPTY_ADD_FORM)

  // Edit price per row
  const [editingPriceId, setEditingPriceId] = useState<string | null>(null)
  const [editingPrice, setEditingPrice] = useState('')

  // Delete confirmation
  const [deletingItemId, setDeletingItemId] = useState<string | null>(null)

  const updateStatus = useUpdateOrderStatus()
  const confirmReception = useConfirmReception()
  const cancelOrder = useCancelOrder()
  const addOrderItem = useAddOrderItem()
  const editOrderItem = useEditOrderItem()
  const editDeliveryTime = useEditDeliveryTime()
  const removeOrderItem = useRemoveOrderItem()

  const handleStatusChange = async (status: OrderStatus) => {
    try {
      await updateStatus.mutateAsync({ id: order.id, status })
      toast.success('Estado actualizado')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al actualizar estado')
    }
  }

  const [isDownloading, setIsDownloading] = useState(false)

  const handleDownloadUrreaOrder = async () => {
    const itemsToOrder = order.order_items.filter((item) => item.quantity_to_order > 0)

    if (itemsToOrder.length === 0) {
      toast.info('No hay productos para pedir a URREA')
      return
    }

    const urreaItems = itemsToOrder.filter((item) => item.brand.toUpperCase() === 'URREA')
    const nonUrreaCount = itemsToOrder.length - urreaItems.length

    if (nonUrreaCount > 0) {
      toast.warning(
        `${nonUrreaCount} producto${nonUrreaCount > 1 ? 's' : ''} no son de marca URREA y fueron excluidos del pedido`
      )
    }

    if (urreaItems.length === 0) {
      toast.info('Ningún producto a pedir es de marca URREA')
      return
    }

    setIsDownloading(true)
    try {
      const blob = await generateUrreaOrderExcel(urreaItems)
      downloadUrreaOrder(blob, order.customer_name)
      toast.success(`Excel de pedido URREA descargado (${urreaItems.length} productos)`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al generar pedido URREA')
    } finally {
      setIsDownloading(false)
    }
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

  const handleConfirmReception = async () => {
    const items = Object.values(itemEdits)

    if (items.length === 0) {
      toast.error('No hay cambios para confirmar')
      return
    }

    try {
      await confirmReception.mutateAsync({
        orderId: order.id,
        input: { items },
      })
      toast.success('Recepción confirmada')
      setItemEdits({})
      router.refresh()
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
      router.refresh()
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
      router.refresh()
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
      router.refresh()
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
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al cancelar orden')
    }
  }

  const itemsToOrder = order.order_items.filter((item) => item.quantity_to_order > 0)
  const urreaItemsToOrder = itemsToOrder.filter((item) => item.brand.toUpperCase() === 'URREA')
  const hasChanges = Object.keys(itemEdits).length > 0
  const isCancelled = order.status === 'cancelled'
  const isCompleted = order.status === 'completed'

  // Use total_amount from database (updated when confirming reception)
  const totalAmount = order.total_amount

  return (
    <div className="space-y-6">
      {/* Order Header */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div>
              <CardTitle className="text-2xl">{order.customer_name}</CardTitle>
              <CardDescription className="mt-1">
                Orden #{order.id.slice(0, 8)} •{' '}
                {new Date(order.created_at).toLocaleDateString('es-MX', {
                  day: '2-digit',
                  month: 'long',
                  year: 'numeric',
                })}
              </CardDescription>
            </div>
            <OrderStatusBadge status={order.status} />
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-4">
            {/* Status Select */}
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

            {/* Download URREA Order */}
            <Button
              variant="outline"
              onClick={handleDownloadUrreaOrder}
              disabled={isDownloading || urreaItemsToOrder.length === 0}
            >
              {isDownloading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Download className="mr-2 h-4 w-4" />
              )}
              Descargar Pedido URREA ({urreaItemsToOrder.length})
            </Button>

            {/* Cancel Order */}
            {!isCancelled && !isCompleted && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="outline"
                    disabled={cancelOrder.isPending}
                    className="border-destructive text-destructive hover:bg-destructive hover:text-white gap-1.5 transition-colors"
                  >
                    <AlertTriangle className="h-4 w-4" strokeWidth={2.5} />
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
          </div>
        </CardContent>
      </Card>

      {/* Order Summary */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-2xl font-bold">{order.order_items.length}</p>
              <p className="text-sm text-muted-foreground">Productos</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-2xl font-bold text-blue-600">
                {order.order_items.reduce((sum, item) => sum + item.quantity_in_stock, 0)}
              </p>
              <p className="text-sm text-muted-foreground">En Stock</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-2xl font-bold text-orange-600">
                {order.order_items.reduce((sum, item) => sum + item.quantity_to_order, 0)}
              </p>
              <p className="text-sm text-muted-foreground">A Pedir URREA</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-2xl font-bold text-green-600">
                ${totalAmount.toLocaleString('es-MX', { minimumFractionDigits: 2 })}
              </p>
              <p className="text-sm text-muted-foreground">Total</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Order Items */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Package className="h-5 w-5" />
                Productos
              </CardTitle>
              {!isCompleted && !isCancelled && (
                <CardDescription>
                  Edita precios, agrega o elimina productos, y registra las cantidades recibidas
                </CardDescription>
              )}
            </div>
            <div className="flex items-center gap-2">
              {!isCompleted && !isCancelled && (
                <Button size="sm" variant="outline" onClick={() => setAddItemOpen(true)}>
                  <Plus className="h-4 w-4 mr-1.5" />
                  Agregar
                </Button>
              )}
              {!isCompleted && !isCancelled && hasChanges && (
                <Button onClick={handleConfirmReception} disabled={confirmReception.isPending}>
                  {confirmReception.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="mr-2 h-4 w-4" />
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
                  <TableHead>Model Code</TableHead>
                  <TableHead>Marca</TableHead>
                  <TableHead className="max-w-[200px]">Descripción</TableHead>
                  <TableHead className="text-right">Aprobados</TableHead>
                  <TableHead className="text-right">En Stock</TableHead>
                  <TableHead className="text-right">A Pedir</TableHead>
                  <TableHead className="text-right">Recibidos</TableHead>
                  <TableHead>Estado de envío</TableHead>
                  <TableHead>Tiempo Entrega</TableHead>
                  <TableHead className="text-right">Precio</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  {!isCompleted && !isCancelled && (
                    <TableHead className="text-center">Acciones</TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {order.order_items.map((item) => {
                  const edit = itemEdits[item.id]
                  const isOrderOpen = !isCompleted && !isCancelled
                  const hasUrreaOrder = item.quantity_to_order > 0
                  // Can edit quantity received only if there's something to order from URREA
                  const canEditQuantity = isOrderOpen && hasUrreaOrder
                  // Can edit URREA status while order is open (even after receiving)
                  const canEditUrreaStatus = isOrderOpen && hasUrreaOrder

                  return (
                    <TableRow key={item.id}>
                      <TableCell className="font-mono text-sm">{item.etm}</TableCell>
                      <TableCell>{item.model_code}</TableCell>
                      <TableCell>{item.brand || '—'}</TableCell>
                      <TableCell className="max-w-[200px] truncate">
                        {item.description}
                      </TableCell>
                      <TableCell className="text-right">{item.quantity_approved}</TableCell>
                      <TableCell className="text-right text-blue-600">
                        {item.quantity_in_stock}
                      </TableCell>
                      <TableCell className="text-right text-orange-600">
                        {item.quantity_to_order}
                      </TableCell>
                      <TableCell className="text-right">
                        {canEditQuantity ? (
                          <Input
                            type="number"
                            min="0"
                            max={item.quantity_to_order}
                            className="w-20 h-8 text-right"
                            value={edit?.quantity_received ?? item.quantity_received}
                            onChange={(e) =>
                              handleItemEdit(
                                item.id,
                                'quantity_received',
                                parseInt(e.target.value) || 0
                              )
                            }
                          />
                        ) : (
                          <span className="text-green-600">{item.quantity_received}</span>
                        )}
                      </TableCell>
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
                        ) : (
                          <span
                            className={
                              !hasUrreaOrder
                                ? 'text-green-600'
                                : item.urrea_status === 'supplied'
                                  ? 'text-green-600'
                                  : item.urrea_status === 'not_supplied'
                                    ? 'text-red-600'
                                    : 'text-yellow-600'
                            }
                          >
                            {!hasUrreaOrder
                              ? 'En stock'
                              : item.urrea_status === 'supplied'
                                ? 'Surtido'
                                : item.urrea_status === 'not_supplied'
                                  ? 'No surtido'
                                  : 'Pendiente'}
                          </span>
                        )}
                      </TableCell>
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
                              size="icon" variant="ghost" className="h-7 w-7 text-green-600"
                              onClick={() => handleSavePrice(item.id)}
                              disabled={editOrderItem.isPending}
                            >
                              <Check className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="icon" variant="ghost" className="h-7 w-7"
                              onClick={() => setEditingPriceId(null)}
                            >
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        ) : (
                          <span>${item.unit_price.toLocaleString('es-MX')}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        ${(() => {
                          let qty = item.quantity_in_stock
                          if (item.urrea_status !== 'not_supplied') {
                            qty += item.quantity_received
                          }
                          return qty * item.unit_price
                        })().toLocaleString('es-MX')}
                      </TableCell>
                      {isOrderOpen && (
                        <TableCell>
                          <div className="flex items-center justify-center gap-1">
                            <Button
                              size="icon" variant="ghost" className="h-7 w-7"
                              onClick={() => handleStartEditPrice(item.id, item.unit_price)}
                              title="Editar precio"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="icon" variant="ghost"
                              className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                              onClick={() => setDeletingItemId(item.id)}
                              title="Eliminar producto"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
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
                  <TableCell
                    colSpan={!isCompleted && !isCancelled ? 12 : 11}
                    className="text-right font-bold"
                  >
                    Total:
                  </TableCell>
                  <TableCell className="text-right font-bold">
                    ${totalAmount.toLocaleString('es-MX', { minimumFractionDigits: 2 })}
                  </TableCell>
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
              {addOrderItem.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
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
              {removeOrderItem.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Sí, eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
