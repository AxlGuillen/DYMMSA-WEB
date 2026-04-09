'use client'

import { Badge } from '@/components/ui/badge'
import type { OrderStatus } from '@/types/database'

const statusConfig: Record<
  OrderStatus,
  { label: string; dot: string; badge: string }
> = {
  ordered: {
    label: 'Pedido',
    dot:   'bg-yellow-500',
    badge: 'bg-yellow-100 text-yellow-800 hover:bg-yellow-100 dark:bg-yellow-900/50 dark:text-yellow-300 dark:hover:bg-yellow-900/50',
  },
  received: {
    label: 'Recibido',
    dot:   'bg-blue-500',
    badge: 'bg-blue-100 text-blue-800 hover:bg-blue-100 dark:bg-blue-900/50 dark:text-blue-300 dark:hover:bg-blue-900/50',
  },
  delivered: {
    label: 'Entregado',
    dot:   'bg-emerald-500',
    badge: 'bg-emerald-100 text-emerald-800 hover:bg-emerald-100 dark:bg-emerald-900/50 dark:text-emerald-300 dark:hover:bg-emerald-900/50',
  },
  completed: {
    label: 'Completado',
    dot:   'bg-green-500',
    badge: 'bg-green-100 text-green-800 hover:bg-green-100 dark:bg-green-900/50 dark:text-green-300 dark:hover:bg-green-900/50',
  },
  cancelled: {
    label: 'Cancelado',
    dot:   'bg-red-500',
    badge: 'bg-red-100 text-red-800 hover:bg-red-100 dark:bg-red-900/50 dark:text-red-300 dark:hover:bg-red-900/50',
  },
}

interface OrderStatusBadgeProps {
  status: OrderStatus
}

export function OrderStatusBadge({ status }: OrderStatusBadgeProps) {
  const config = statusConfig[status]

  return (
    <Badge variant="outline" className={config.badge}>
      <span className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full shrink-0 ${config.dot}`} />
      {config.label}
    </Badge>
  )
}
