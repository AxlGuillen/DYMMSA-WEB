'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { Package, Warehouse, ShoppingCart, DollarSign } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { OrderStatusBadge } from '@/components/orders/OrderStatusBadge'
import { MetricCard } from './MetricCard'
import { OrderStatusBreakdown } from './OrderStatusBreakdown'
import { useDashboard, type DateRange } from '@/hooks/useDashboard'

type Preset = '7d' | '30d' | 'month'

function getPresetRange(preset: Preset): DateRange {
  const now = new Date()
  const to = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59)

  let from: Date
  if (preset === '7d') {
    from = new Date(to)
    from.setDate(from.getDate() - 6)
  } else if (preset === '30d') {
    from = new Date(to)
    from.setDate(from.getDate() - 29)
  } else {
    from = new Date(now.getFullYear(), now.getMonth(), 1)
  }

  from.setHours(0, 0, 0, 0)

  return {
    from: from.toISOString(),
    to: to.toISOString(),
  }
}

function formatDate(iso: string): string {
  return iso.slice(0, 10)
}

function formatCurrency(amount: number): string {
  return `$${amount.toLocaleString('es-MX', { minimumFractionDigits: 2 })}`
}

export function DashboardMetrics() {
  const [activePreset, setActivePreset] = useState<Preset | null>('30d')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')

  const dateRange = useMemo<DateRange>(() => {
    if (activePreset) {
      return getPresetRange(activePreset)
    }
    // Custom range
    const from = customFrom
      ? new Date(customFrom + 'T00:00:00').toISOString()
      : new Date(0).toISOString()
    const to = customTo
      ? new Date(customTo + 'T23:59:59').toISOString()
      : new Date().toISOString()
    return { from, to }
  }, [activePreset, customFrom, customTo])

  const { data, isLoading } = useDashboard(dateRange)

  const presets: { key: Preset; label: string }[] = [
    { key: '7d', label: '7 dias' },
    { key: '30d', label: '30 dias' },
    { key: 'month', label: 'Este mes' },
  ]

  return (
    <div className="space-y-6">
      {/* Date filter */}
      <div className="flex flex-wrap items-center gap-2">
        {presets.map((p) => (
          <button
            key={p.key}
            onClick={() => {
              setActivePreset(p.key)
              setCustomFrom('')
              setCustomTo('')
            }}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              activePreset === p.key
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            }`}
          >
            {p.label}
          </button>
        ))}
        <span className="text-muted-foreground text-sm">|</span>
        <input
          type="date"
          value={activePreset ? formatDate(dateRange.from) : customFrom}
          onChange={(e) => {
            setActivePreset(null)
            setCustomFrom(e.target.value)
          }}
          className="rounded-md border bg-background px-2 py-1.5 text-sm"
        />
        <span className="text-muted-foreground text-sm">-</span>
        <input
          type="date"
          value={activePreset ? formatDate(dateRange.to) : customTo}
          onChange={(e) => {
            setActivePreset(null)
            setCustomTo(e.target.value)
          }}
          className="rounded-md border bg-background px-2 py-1.5 text-sm"
        />
      </div>

      {/* Metric cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title="Productos ETM"
          value={data?.etmCount ?? 0}
          description="Total en catalogo"
          icon={<Package className="h-4 w-4" />}
          isLoading={isLoading}
        />
        <MetricCard
          title="Items Inventario"
          value={data?.inventoryCount ?? 0}
          description="Productos en tienda"
          icon={<Warehouse className="h-4 w-4" />}
          isLoading={isLoading}
        />
        <MetricCard
          title="Ordenes"
          value={data?.ordersInRange ?? 0}
          description="En periodo seleccionado"
          icon={<ShoppingCart className="h-4 w-4" />}
          isLoading={isLoading}
        />
        <MetricCard
          title="Ventas Cerradas"
          value={data ? formatCurrency(data.totalSales) : '$0.00'}
          description="Pagadas y completadas"
          icon={<DollarSign className="h-4 w-4" />}
          isLoading={isLoading}
        />
      </div>

      {/* Bottom row */}
      <div className="grid gap-4 md:grid-cols-2">
        <OrderStatusBreakdown
          statusCounts={
            data?.statusCounts ?? {
              pending_urrea_order: 0,
              received_from_urrea: 0,
              pending_payment: 0,
              paid: 0,
              completed: 0,
              cancelled: 0,
            }
          }
          isLoading={isLoading}
        />

        {/* Recent orders */}
        <Card>
          <CardHeader>
            <CardTitle>Ordenes Recientes</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="flex items-center justify-between">
                    <Skeleton className="h-5 w-32" />
                    <Skeleton className="h-5 w-20" />
                  </div>
                ))}
              </div>
            ) : data?.recentOrders.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No hay ordenes en este periodo.
              </p>
            ) : (
              <div className="space-y-3">
                {data?.recentOrders.map((order) => (
                  <Link
                    key={order.id}
                    href={`/dashboard/orders/${order.id}`}
                    className="flex items-center justify-between rounded-md px-2 py-1.5 transition-colors hover:bg-muted"
                  >
                    <div className="flex flex-col gap-0.5">
                      <span className="text-sm font-medium">
                        {order.customer_name}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {formatCurrency(order.total_amount)}
                      </span>
                    </div>
                    <OrderStatusBadge status={order.status} />
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
