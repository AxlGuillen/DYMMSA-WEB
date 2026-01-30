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

// Custom colors for each status (light + dark)
const statusColors: Record<OrderStatus, string> = {
  pending_urrea_order: 'bg-yellow-100 text-yellow-800 hover:bg-yellow-100 dark:bg-yellow-900/50 dark:text-yellow-300 dark:hover:bg-yellow-900/50',
  received_from_urrea: 'bg-blue-100 text-blue-800 hover:bg-blue-100 dark:bg-blue-900/50 dark:text-blue-300 dark:hover:bg-blue-900/50',
  pending_payment: 'bg-orange-100 text-orange-800 hover:bg-orange-100 dark:bg-orange-900/50 dark:text-orange-300 dark:hover:bg-orange-900/50',
  paid: 'bg-emerald-100 text-emerald-800 hover:bg-emerald-100 dark:bg-emerald-900/50 dark:text-emerald-300 dark:hover:bg-emerald-900/50',
  completed: 'bg-green-100 text-green-800 hover:bg-green-100 dark:bg-green-900/50 dark:text-green-300 dark:hover:bg-green-900/50',
  cancelled: 'bg-red-100 text-red-800 hover:bg-red-100 dark:bg-red-900/50 dark:text-red-300 dark:hover:bg-red-900/50',
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
