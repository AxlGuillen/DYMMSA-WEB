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
import { OrderStatusBadge } from './OrderStatusBadge'
import { generateUrreaOrderExcel, downloadUrreaOrder } from '@/lib/excel/generator'
import {
  useUpdateOrderStatus,
  useConfirmReception,
  useCancelOrder,
} from '@/hooks/useOrders'
import type { OrderWithItems, OrderStatus, UrreaStatus } from '@/types/database'

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

  const updateStatus = useUpdateOrderStatus()
  const confirmReception = useConfirmReception()
  const cancelOrder = useCancelOrder()

  const handleStatusChange = async (status: OrderStatus) => {
    try {
      await updateStatus.mutateAsync({ id: order.id, status })
      toast.success('Estado actualizado')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al actualizar estado')
    }
  }

  const handleDownloadUrreaOrder = () => {
    const itemsToOrder = order.order_items.filter((item) => item.quantity_to_order > 0)

    if (itemsToOrder.length === 0) {
      toast.info('No hay productos para pedir a URREA')
      return
    }

    const blob = generateUrreaOrderExcel(order.order_items)
    downloadUrreaOrder(blob, order.customer_name)
    toast.success('Excel de pedido URREA descargado')
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

  const handleCancelOrder = async () => {
    try {
      await cancelOrder.mutateAsync(order.id)
      toast.success('Orden cancelada')
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al cancelar orden')
    }
  }

  const totalAmount = order.order_items.reduce(
    (sum, item) => sum + item.quantity_approved * item.unit_price,
    0
  )

  const itemsToOrder = order.order_items.filter((item) => item.quantity_to_order > 0)
  const hasChanges = Object.keys(itemEdits).length > 0
  const isCancelled = order.status === 'cancelled'
  const isCompleted = order.status === 'completed'

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
            {itemsToOrder.length > 0 && (
              <Button variant="outline" onClick={handleDownloadUrreaOrder}>
                <Download className="mr-2 h-4 w-4" />
                Descargar Pedido URREA ({itemsToOrder.length})
              </Button>
            )}

            {/* Cancel Order */}
            {!isCancelled && !isCompleted && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" disabled={cancelOrder.isPending}>
                    <AlertTriangle className="mr-2 h-4 w-4" />
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
              {order.status === 'pending_urrea_order' && (
                <CardDescription>
                  Edita las cantidades recibidas y el estado de URREA
                </CardDescription>
              )}
            </div>
            {order.status === 'pending_urrea_order' && hasChanges && (
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
        </CardHeader>
        <CardContent>
          <div className="rounded-md border overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ETM</TableHead>
                  <TableHead>Model Code</TableHead>
                  <TableHead className="max-w-[200px]">Descripción</TableHead>
                  <TableHead className="text-right">Aprobados</TableHead>
                  <TableHead className="text-right">En Stock</TableHead>
                  <TableHead className="text-right">A Pedir</TableHead>
                  <TableHead className="text-right">Recibidos</TableHead>
                  <TableHead>Estado URREA</TableHead>
                  <TableHead className="text-right">Precio</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {order.order_items.map((item) => {
                  const edit = itemEdits[item.id]
                  const canEdit = order.status === 'pending_urrea_order' && item.quantity_to_order > 0

                  return (
                    <TableRow key={item.id}>
                      <TableCell className="font-mono text-sm">{item.etm}</TableCell>
                      <TableCell>{item.model_code}</TableCell>
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
                        {canEdit ? (
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
                        {canEdit ? (
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
                              item.urrea_status === 'supplied'
                                ? 'text-green-600'
                                : item.urrea_status === 'not_supplied'
                                  ? 'text-red-600'
                                  : 'text-yellow-600'
                            }
                          >
                            {item.urrea_status === 'supplied'
                              ? 'Surtido'
                              : item.urrea_status === 'not_supplied'
                                ? 'No surtido'
                                : 'Pendiente'}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        ${item.unit_price.toLocaleString('es-MX')}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        ${(item.quantity_approved * item.unit_price).toLocaleString('es-MX')}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={9} className="text-right font-bold">
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
    </div>
  )
}
