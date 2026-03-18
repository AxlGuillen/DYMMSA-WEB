'use client'

import { PieChart, Pie, Cell, Tooltip } from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import type { OrderStatus } from '@/types/database'

const STATUS_CONFIG: Record<OrderStatus, { label: string; color: string }> = {
  pending_urrea_order: { label: 'Pendiente URREA', color: '#EAB308' },
  received_from_urrea: { label: 'Recibido URREA',  color: '#3B82F6' },
  pending_payment:     { label: 'Pendiente Pago',  color: '#F97316' },
  paid:                { label: 'Pagado',           color: '#10B981' },
  completed:           { label: 'Completado',       color: '#22C55E' },
  cancelled:           { label: 'Cancelado',        color: '#EF4444' },
}

const ALL_STATUSES: OrderStatus[] = [
  'pending_urrea_order',
  'received_from_urrea',
  'pending_payment',
  'paid',
  'completed',
  'cancelled',
]

interface CustomTooltipProps {
  active?: boolean
  payload?: { name: string; value: number }[]
}

function CustomTooltip({ active, payload }: CustomTooltipProps) {
  if (!active || !payload?.length) return null
  const { name, value } = payload[0]
  return (
    <div className="rounded-lg border bg-background px-3 py-2 shadow-md">
      <p className="text-sm font-medium">{name}</p>
      <p className="text-xs text-muted-foreground">
        {value} {value === 1 ? 'orden' : 'ordenes'}
      </p>
    </div>
  )
}

interface OrderStatusBreakdownProps {
  statusCounts: Record<OrderStatus, number>
  isLoading?: boolean
}

export function OrderStatusBreakdown({
  statusCounts,
  isLoading,
}: OrderStatusBreakdownProps) {
  const total = Object.values(statusCounts).reduce((sum, n) => sum + n, 0)

  const chartData = ALL_STATUSES
    .filter((s) => statusCounts[s] > 0)
    .map((s) => ({
      status: s,
      name: STATUS_CONFIG[s].label,
      value: statusCounts[s],
      color: STATUS_CONFIG[s].color,
    }))

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
            <Skeleton className="h-[200px] w-[200px] rounded-full" />
            <div className="grid w-full grid-cols-2 gap-x-6 gap-y-2.5">
              {ALL_STATUSES.map((s) => (
                <div key={s} className="flex items-center gap-2">
                  <Skeleton className="h-2.5 w-2.5 rounded-full" />
                  <Skeleton className="h-3 flex-1" />
                </div>
              ))}
            </div>
          </div>
        ) : total === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
            <div className="h-[200px] w-[200px] rounded-full border-8 border-muted" />
            <p className="text-sm text-muted-foreground">
              Sin ordenes en este periodo
            </p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-5">
            {/* Donut chart */}
            <div className="relative h-[200px] w-[200px]">
              <PieChart width={200} height={200}>
                <Pie
                  data={chartData}
                  cx="50%"
                  cy="50%"
                  innerRadius={62}
                  outerRadius={90}
                  paddingAngle={2}
                  dataKey="value"
                  strokeWidth={0}
                >
                  {chartData.map((entry) => (
                    <Cell key={entry.status} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
              </PieChart>

              {/* Center label */}
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-3xl font-bold leading-none">{total}</span>
                <span className="mt-1 text-xs text-muted-foreground">ordenes</span>
              </div>
            </div>

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
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
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
