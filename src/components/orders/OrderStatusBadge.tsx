'use client'

import { Badge } from '@/components/ui/badge'
import type { OrderStatus } from '@/types/database'

const statusConfig: Record<
  OrderStatus,
  { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }
> = {
  pending_urrea_order: {
    label: 'Pendiente URREA',
    variant: 'secondary',
  },
  received_from_urrea: {
    label: 'Recibido URREA',
    variant: 'default',
  },
  pending_payment: {
    label: 'Pendiente Pago',
    variant: 'outline',
  },
  paid: {
    label: 'Pagado',
    variant: 'default',
  },
  completed: {
    label: 'Completado',
    variant: 'default',
  },
  cancelled: {
    label: 'Cancelado',
    variant: 'destructive',
  },
}

// Custom colors for each status
const statusColors: Record<OrderStatus, string> = {
  pending_urrea_order: 'bg-yellow-100 text-yellow-800 hover:bg-yellow-100',
  received_from_urrea: 'bg-blue-100 text-blue-800 hover:bg-blue-100',
  pending_payment: 'bg-orange-100 text-orange-800 hover:bg-orange-100',
  paid: 'bg-emerald-100 text-emerald-800 hover:bg-emerald-100',
  completed: 'bg-green-100 text-green-800 hover:bg-green-100',
  cancelled: 'bg-red-100 text-red-800 hover:bg-red-100',
}

interface OrderStatusBadgeProps {
  status: OrderStatus
}

export function OrderStatusBadge({ status }: OrderStatusBadgeProps) {
  const config = statusConfig[status]

  return (
    <Badge variant={config.variant} className={statusColors[status]}>
      {config.label}
    </Badge>
  )
}
