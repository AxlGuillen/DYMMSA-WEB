'use client'

import dynamic from 'next/dynamic'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import type { OrderStatus } from '@/types/database'

const OrderStatusDonut = dynamic(() => import('./OrderStatusDonut'), { ssr: false })

const STATUS_CONFIG: Record<OrderStatus, { label: string; color: string }> = {
  ordered:   { label: 'Pedido',     color: '#EAB308' },
  received:  { label: 'Recibido',   color: '#3B82F6' },
  delivered: { label: 'Entregado',  color: '#10B981' },
  completed: { label: 'Completado', color: '#22C55E' },
  cancelled: { label: 'Cancelado',  color: '#EF4444' },
}

const ALL_STATUSES: OrderStatus[] = [
  'ordered',
  'received',
  'delivered',
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
  const total = Object.values(statusCounts).reduce((sum, n) => sum + n, 0)

  const chartData = ALL_STATUSES.flatMap((s) =>
    statusCounts[s] > 0
      ? [{
          status: s,
          name: STATUS_CONFIG[s].label,
          value: statusCounts[s],
          color: STATUS_CONFIG[s].color,
        }]
      : []
  )

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-4">
        <CardTitle>Ordenes por Estado</CardTitle>
        {!isLoading && total > 0 && (
          <span className="text-sm font-medium text-muted-foreground">
            {total} total
          </span>
        )}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex flex-col items-center gap-6">
            <Skeleton className="size-[200px] rounded-full" />
            <div className="grid w-full grid-cols-2 gap-x-6 gap-y-2.5">
              {ALL_STATUSES.map((s) => (
                <div key={s} className="flex items-center gap-2">
                  <Skeleton className="size-2.5 rounded-full" />
                  <Skeleton className="h-3 flex-1" />
                </div>
              ))}
            </div>
          </div>
        ) : total === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
            <div className="size-[200px] rounded-full border-8 border-muted" />
            <p className="text-sm text-muted-foreground">
              Sin ordenes en este periodo
            </p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-5">
            {/* Donut chart (recharts lazy-loaded) */}
            <OrderStatusDonut chartData={chartData} total={total} />

            {/* Legend */}
            <div className="grid w-full grid-cols-2 gap-x-6 gap-y-2.5">
              {ALL_STATUSES.map((status) => {
                const count = statusCounts[status]
                const { label, color } = STATUS_CONFIG[status]
                return (
                  <div
                    key={status}
                    className="flex items-center gap-2"
                    style={{ opacity: count === 0 ? 0.4 : 1 }}
                  >
                    <div
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: color }}
                    />
                    <span className="truncate text-xs text-muted-foreground">
                      {label}
                    </span>
                    <span className="ml-auto text-xs font-medium tabular-nums">
                      {count}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
