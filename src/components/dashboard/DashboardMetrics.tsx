'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { Package, Warehouse, ShoppingCart, DollarSign, ArrowRight } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { OrderStatusBadge } from '@/components/orders/OrderStatusBadge'
import { MetricCard } from './MetricCard'
import { OrderStatusBreakdown } from './OrderStatusBreakdown'
import { useDashboard, type DateRange } from '@/hooks/useDashboard'
import { useCurrency } from '@/hooks/useCurrency'
import { cn } from '@/lib/utils'

type Preset = '7d' | '30d' | 'month' | 'all'

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
  } else if (preset === 'month') {
    from = new Date(now.getFullYear(), now.getMonth(), 1)
  } else {
    // 'all' — desde el inicio del tiempo (Unix epoch) hasta hoy
    from = new Date(0)
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


function getCustomerInitials(name: string): string {
  return name
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
}

function formatRelativeDate(iso: string): string {
  const date = new Date(iso)
  const diffDays = Math.floor((Date.now() - date.getTime()) / 86_400_000)
  if (diffDays === 0) return 'Hoy'
  if (diffDays === 1) return 'Ayer'
  if (diffDays < 7) return `Hace ${diffDays} días`
  return date.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })
}

export function DashboardMetrics() {
  const fmt = useCurrency()
  const [activePreset, setActivePreset] = useState<Preset | null>('30d')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')

  const dateRange = useMemo<DateRange>(() => {
    if (activePreset) {
      return getPresetRange(activePreset)
    }
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
    { key: '7d',    label: '7 días' },
    { key: '30d',   label: '30 días' },
    { key: 'month', label: 'Este mes' },
    { key: 'all',   label: 'Todo' },
  ]

  return (
    <div className="space-y-6">
      {/* Date filter */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Segmented control */}
        <div className="inline-flex rounded-lg border bg-muted/40 p-1 gap-0.5">
          {presets.map((p) => (
            <button type="button"
              key={p.key}
              onClick={() => {
                setActivePreset(p.key)
                setCustomFrom('')
                setCustomTo('')
              }}
              className={cn(
                'rounded-md px-3 py-1 text-sm font-medium transition-all',
                activePreset === p.key
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {p.label}
            </button>
          ))}
        </div>

        <span className="text-muted-foreground/50 text-sm select-none">|</span>

        {/* Custom range */}
        <div className="flex items-center gap-2">
          <input
            type="date"
            aria-label="Fecha desde"
            value={
              activePreset === 'all'
                ? ''
                : activePreset
                ? formatDate(dateRange.from)
                : customFrom
            }
            onChange={(e) => {
              setActivePreset(null)
              setCustomFrom(e.target.value)
            }}
            className="rounded-lg border bg-background px-2.5 py-1.5 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <span className="text-muted-foreground text-sm">{'\u2014'}</span>
          <input
            type="date"
            aria-label="Fecha hasta"
            value={activePreset ? formatDate(dateRange.to) : customTo}
            onChange={(e) => {
              setActivePreset(null)
              setCustomTo(e.target.value)
            }}
            className="rounded-lg border bg-background px-2.5 py-1.5 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      </div>

      {/* Metric cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title="Productos ETM"
          value={data?.etmCount ?? 0}
          description="Total en catalogo"
          icon={<Package className="size-4" />}
          color="blue"
          isLoading={isLoading}
        />
        <MetricCard
          title="Items Inventario"
          value={data?.inventoryCount ?? 0}
          description="Productos en tienda"
          icon={<Warehouse className="size-4" />}
          color="green"
          isLoading={isLoading}
        />
        <MetricCard
          title="Ordenes"
          value={data?.ordersInRange ?? 0}
          description="En periodo seleccionado"
          icon={<ShoppingCart className="size-4" />}
          color="orange"
          isLoading={isLoading}
        />
        <MetricCard
          title="Ventas Cerradas"
          value={fmt(data?.totalSales ?? 0)}
          description="Pagadas y completadas"
          icon={<DollarSign className="size-4" />}
          color="purple"
          isLoading={isLoading}
        />
      </div>

      {/* Bottom row */}
      <div className="grid gap-4 md:grid-cols-2">
        <OrderStatusBreakdown
          statusCounts={
            data?.statusCounts ?? {
              ordered: 0,
              received: 0,
              delivered: 0,
              completed: 0,
              cancelled: 0,
            }
          }
          isLoading={isLoading}
        />

        {/* Recent orders */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-4">
            <CardTitle>Ordenes Recientes</CardTitle>
            <Link
              href="/dashboard/orders"
              className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              Ver todas
              <ArrowRight className="size-3" />
            </Link>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <Skeleton className="size-8 rounded-full" />
                    <div className="flex-1 space-y-1">
                      <Skeleton className="h-4 w-32" />
                      <Skeleton className="h-3 w-20" />
                    </div>
                    <Skeleton className="h-5 w-20" />
                  </div>
                ))}
              </div>
            ) : data?.recentOrders.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No hay ordenes en este periodo.
              </p>
            ) : (
              <div className="space-y-1">
                {data?.recentOrders.map((order) => (
                  <Link
                    key={order.id}
                    href={`/dashboard/orders/${order.id}`}
                    className="flex items-center gap-3 rounded-lg p-2  transition-colors hover:bg-muted"
                  >
                    {/* Avatar */}
                    <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                      {getCustomerInitials(order.customer_name)}
                    </div>

                    {/* Info */}
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate text-sm font-medium">
                        {order.customer_name}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {fmt(order.total_amount)}
                      </span>
                    </div>

                    {/* Status + date */}
                    <div className="flex shrink-0 flex-col items-end gap-0.5">
                      <OrderStatusBadge status={order.status} />
                      <span className="text-xs text-muted-foreground">
                        {formatRelativeDate(order.created_at)}
                      </span>
                    </div>
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
