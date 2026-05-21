'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ShoppingCart } from 'lucide-react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { OrderStatusBadge } from './OrderStatusBadge'
import { useCurrency } from '@/hooks/useCurrency'
import type { OrderWithCount } from '@/types/database'

function formatRelative(dateStr: string): string {
  const diff  = Date.now() - new Date(dateStr).getTime()
  const mins  = Math.floor(diff / 60_000)
  const hours = Math.floor(diff / 3_600_000)
  const days  = Math.floor(diff / 86_400_000)
  if (mins  <  2) return 'hace un momento'
  if (mins  < 60) return `hace ${mins} min`
  if (hours < 24) return `hace ${hours}h`
  if (days  === 1) return 'ayer'
  if (days  <  7) return `hace ${days} días`
  if (days  < 30) return `hace ${Math.floor(days / 7)} sem`
  return new Date(dateStr).toLocaleDateString('es-MX', {
    day: '2-digit', month: 'short', year: 'numeric',
  })
}

function formatAbsolute(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('es-MX', {
    day: '2-digit', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

interface OrdersTableProps {
  orders: OrderWithCount[]
  isLoading: boolean
}

export function OrdersTable({ orders, isLoading }: OrdersTableProps) {
  const router = useRouter()
  const fmt = useCurrency()

  if (isLoading) {
    return (
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nombre</TableHead>
              <TableHead>Odoo ID</TableHead>
              <TableHead>Cliente</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="text-center">Ítems</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead>Fecha</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {[...Array(5)].map((_, i) => (
              <TableRow key={i}>
                <TableCell><Skeleton className="h-4 w-40" /></TableCell>
                <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                <TableCell><Skeleton className="h-6 w-28" /></TableCell>
                <TableCell><Skeleton className="h-4 w-8 mx-auto" /></TableCell>
                <TableCell><Skeleton className="h-4 w-20 ml-auto" /></TableCell>
                <TableCell><Skeleton className="h-4 w-24" /></TableCell>
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
          <ShoppingCart className="h-8 w-8 text-muted-foreground" />
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
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Nombre</TableHead>
            <TableHead>Odoo ID</TableHead>
            <TableHead>Cliente</TableHead>
            <TableHead>Estado</TableHead>
            <TableHead className="text-center">Ítems</TableHead>
            <TableHead className="text-right">Total</TableHead>
            <TableHead>Fecha</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {orders.map((order) => (
            <TableRow
              key={order.id}
              className="group cursor-pointer hover:bg-muted/50"
              onClick={() => router.push(`/dashboard/orders/${order.id}`)}
            >
              <TableCell className="font-medium">
                {order.name || <span className="text-muted-foreground italic text-xs">Sin nombre</span>}
              </TableCell>
              <TableCell className="text-sm font-mono">
                {order.odoo_id ?? <span className="text-muted-foreground">—</span>}
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">{order.customer_name}</TableCell>
              <TableCell>
                <OrderStatusBadge status={order.status} />
              </TableCell>
              <TableCell className="text-center tabular-nums text-sm text-muted-foreground">
                {order.items_count}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {order.total_amount > 0
                  ? fmt(order.total_amount)
                  : <span className="text-muted-foreground text-sm">—</span>}
              </TableCell>
              <TableCell
                className="text-muted-foreground text-sm whitespace-nowrap"
                title={formatAbsolute(order.created_at)}
              >
                {formatRelative(order.created_at)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
