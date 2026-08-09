'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ShoppingCart, Trash2, Loader2 } from '@/components/icons'
import { toast } from 'sonner'
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { OrderStatusBadge } from './OrderStatusBadge'
import { useDeleteOrder } from '@/hooks/useOrders'
import { useCurrency } from '@/hooks/useCurrency'
import { formatRelative, formatAbsolute } from '@/lib/format'
import { useVisibleColumns, type TableColumn } from '@/hooks/useVisibleColumns'
import { useColumnWidths, RESIZABLE_TABLE_CLASS, STICKY_ACTIONS_CELL } from '@/hooks/useColumnWidths'
import { ResizableHead } from '@/components/ResizableHead'
import type { OrderWithCount } from '@/types/database'

// Columnas de la lista (issue #18). Nombre y acciones son fijas.
export const ORDERS_COLUMNS: readonly TableColumn[] = [
  { id: 'odoo_id', label: 'Odoo ID', width: 120 },
  { id: 'name', label: 'Nombre', hideable: false, width: 240 },
  { id: 'customer', label: 'Cliente', width: 200 },
  { id: 'status', label: 'Estado', width: 150 },
  { id: 'items_count', label: 'Ítems', width: 80 },
  { id: 'total', label: 'Total', width: 120 },
  { id: 'created_at', label: 'Fecha', width: 140 },
  { id: 'actions', label: 'Acciones', hideable: false, width: 90 },
]

interface OrdersTableProps {
  orders: OrderWithCount[]
  isLoading: boolean
}

export function OrdersTable({ orders, isLoading }: OrdersTableProps) {
  const { push } = useRouter()
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const deleteOrder = useDeleteOrder()
  const fmt = useCurrency()
  const cols = useVisibleColumns('orders-list', ORDERS_COLUMNS)
  const widths = useColumnWidths('orders-list', ORDERS_COLUMNS)

  // Header compartido entre skeleton y tabla real (guards escritos una vez).
  const tableHeaders = (
    <TableHeader>
      <TableRow>
        {cols.isVisible('odoo_id') && <ResizableHead id="odoo_id" label="Odoo ID" widths={widths} />}
        <ResizableHead id="name" label="Nombre" widths={widths} />
        {cols.isVisible('customer') && <ResizableHead id="customer" label="Cliente" widths={widths} />}
        {cols.isVisible('status') && <ResizableHead id="status" label="Estado" widths={widths} />}
        {cols.isVisible('items_count') && <ResizableHead id="items_count" label="Ítems" widths={widths} className="text-center" />}
        {cols.isVisible('total') && <ResizableHead id="total" label="Total" widths={widths} className="text-right" />}
        {cols.isVisible('created_at') && <ResizableHead id="created_at" label="Fecha" widths={widths} />}
        <ResizableHead id="actions" label="Acciones" widths={widths} className="text-center" sticky />
      </TableRow>
    </TableHeader>
  )

  const handleDelete = async () => {
    if (!deletingId) return
    try {
      await deleteOrder.mutateAsync(deletingId)
      toast.success('Orden eliminada')
      setDeletingId(null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al eliminar la orden')
    }
  }

  if (isLoading) {
    return (
      <div className="rounded-md border overflow-x-auto">
        <Table className={RESIZABLE_TABLE_CLASS}>
          {tableHeaders}
          <TableBody>
            {[...Array(5)].map((_, i) => (
              <TableRow key={i} className="bg-background">
                {cols.isVisible('odoo_id') && <TableCell><Skeleton className="h-4 w-24" /></TableCell>}
                <TableCell><Skeleton className="h-4 w-40" /></TableCell>
                {cols.isVisible('customer') && <TableCell><Skeleton className="h-4 w-32" /></TableCell>}
                {cols.isVisible('status') && <TableCell><Skeleton className="h-6 w-28" /></TableCell>}
                {cols.isVisible('items_count') && <TableCell><Skeleton className="h-4 w-8 mx-auto" /></TableCell>}
                {cols.isVisible('total') && <TableCell><Skeleton className="h-4 w-20 ml-auto" /></TableCell>}
                {cols.isVisible('created_at') && <TableCell><Skeleton className="h-4 w-24" /></TableCell>}
                <TableCell className={STICKY_ACTIONS_CELL} />
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    )
  }

  if (orders.length === 0) {
    return (
      <div className="rounded-md border p-16 flex flex-col items-center gap-4 text-center">
        <div className="rounded-full bg-muted p-4">
          <ShoppingCart className="size-8 text-muted-foreground" />
        </div>
        <div>
          <p className="font-medium">No hay órdenes</p>
          <p className="text-sm text-muted-foreground mt-1">
            Las órdenes se generan desde una cotización aprobada.
          </p>
        </div>
        <Link href="/dashboard/quotations">
          <Button size="sm" className="mt-2">Ver cotizaciones</Button>
        </Link>
      </div>
    )
  }

  return (
    <>
      <div className="rounded-md border overflow-x-auto">
        <Table className={RESIZABLE_TABLE_CLASS}>
          {tableHeaders}
          <TableBody>
            {orders.map((order) => (
              <TableRow
                key={order.id}
                // Fondos OPACOS: la columna fija de acciones los hereda con
                // `bg-inherit`, y con alfa se vería el contenido pasando debajo.
                className="group cursor-pointer bg-background hover:bg-muted"
                onClick={() => push(`/dashboard/orders/${order.id}`)}
              >
                {cols.isVisible('odoo_id') && (
                  <TableCell className="text-sm font-mono text-muted-foreground">
                    {order.odoo_id ?? <span className="text-muted-foreground">{'—'}</span>}
                  </TableCell>
                )}
                <TableCell className="font-medium">
                  {order.name || <span className="text-muted-foreground italic text-xs">Sin nombre</span>}
                </TableCell>
                {cols.isVisible('customer') && (
                  <TableCell className="text-sm text-muted-foreground">{order.customer_name}</TableCell>
                )}
                {cols.isVisible('status') && (
                  <TableCell>
                    <OrderStatusBadge status={order.status} />
                  </TableCell>
                )}
                {cols.isVisible('items_count') && (
                  <TableCell className="text-center tabular-nums text-sm text-muted-foreground">
                    {order.items_count}
                  </TableCell>
                )}
                {cols.isVisible('total') && (
                  <TableCell className="text-right tabular-nums">
                    {order.total_amount > 0
                      ? fmt(order.total_amount)
                      : <span className="text-muted-foreground text-sm">{'—'}</span>}
                  </TableCell>
                )}
                {cols.isVisible('created_at') && (
                  <TableCell
                    className="text-muted-foreground text-sm whitespace-nowrap"
                    title={formatAbsolute(order.created_at)}
                  >
                    {formatRelative(order.created_at)}
                  </TableCell>
                )}
                <TableCell className={`${STICKY_ACTIONS_CELL} text-center`} onClick={(e) => e.stopPropagation()}>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="size-7 text-destructive hover:text-destructive hover:bg-destructive/10 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => setDeletingId(order.id)}
                    title="Eliminar orden"
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <AlertDialog
        open={!!deletingId}
        onOpenChange={(o) => { if (!o && !deleteOrder.isPending) setDeletingId(null) }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar esta orden?</AlertDialogTitle>
            <AlertDialogDescription>
              Se eliminará la orden y todos sus ítems. Si la orden tenía stock descontado del
              inventario, será restaurado automáticamente. Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteOrder.isPending}>Cancelar</AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              onClick={handleDelete}
              disabled={deleteOrder.isPending}
            >
              {deleteOrder.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
              Sí, eliminar
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
