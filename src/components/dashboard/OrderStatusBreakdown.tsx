'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { OrderStatusBadge } from '@/components/orders/OrderStatusBadge'
import type { OrderStatus } from '@/types/database'

const ALL_STATUSES: OrderStatus[] = [
  'pending_urrea_order',
  'received_from_urrea',
  'pending_payment',
  'paid',
  'completed',
  'cancelled',
]

interface OrderStatusBreakdownProps {
  statusCounts: Record<OrderStatus, number>
  isLoading?: boolean
}

export function OrderStatusBreakdown({
  statusCounts,
  isLoading,
}: OrderStatusBreakdownProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Ordenes por Estado</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {isLoading
            ? ALL_STATUSES.map((status) => (
                <div key={status} className="flex items-center justify-between">
                  <Skeleton className="h-5 w-28" />
                  <Skeleton className="h-5 w-8" />
                </div>
              ))
            : ALL_STATUSES.map((status) => (
                <div key={status} className="flex items-center justify-between">
                  <OrderStatusBadge status={status} />
                  <span className="text-sm font-medium tabular-nums">
                    {statusCounts[status]}
                  </span>
                </div>
              ))}
        </div>
      </CardContent>
    </Card>
  )
}
