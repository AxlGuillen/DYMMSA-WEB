'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Plus, Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { OrdersTable } from '@/components/orders/OrdersTable'
import { useOrders, useOrderStats } from '@/hooks/useOrders'
import type { OrderStatus } from '@/types/database'

const STATUS_OPTIONS: { value: OrderStatus | 'all'; label: string }[] = [
  { value: 'all',                 label: 'Todos los estados' },
  { value: 'pending_urrea_order', label: 'Pendiente URREA' },
  { value: 'received_from_urrea', label: 'Recibido URREA' },
  { value: 'pending_payment',     label: 'Pendiente Pago' },
  { value: 'paid',                label: 'Pagado' },
  { value: 'completed',           label: 'Completado' },
  { value: 'cancelled',           label: 'Cancelado' },
]

const STAT_CARDS: {
  status: OrderStatus
  label: string
  dot: string
  color: string
  bg: string
  ring: string
}[] = [
  { status: 'pending_urrea_order', label: 'Pend. URREA',   dot: 'bg-yellow-500',  color: 'text-yellow-700 dark:text-yellow-300',  bg: 'bg-yellow-50 hover:bg-yellow-100 dark:bg-yellow-900/30 dark:hover:bg-yellow-900/50',   ring: 'ring-yellow-400'  },
  { status: 'received_from_urrea', label: 'Recibido',       dot: 'bg-blue-500',    color: 'text-blue-700 dark:text-blue-300',      bg: 'bg-blue-50 hover:bg-blue-100 dark:bg-blue-900/30 dark:hover:bg-blue-900/50',           ring: 'ring-blue-400'    },
  { status: 'pending_payment',     label: 'Pend. Pago',     dot: 'bg-orange-500',  color: 'text-orange-700 dark:text-orange-300',  bg: 'bg-orange-50 hover:bg-orange-100 dark:bg-orange-900/30 dark:hover:bg-orange-900/50',   ring: 'ring-orange-400'  },
  { status: 'paid',                label: 'Pagado',          dot: 'bg-emerald-500', color: 'text-emerald-700 dark:text-emerald-300',bg: 'bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-900/30 dark:hover:bg-emerald-900/50',ring: 'ring-emerald-400' },
  { status: 'completed',           label: 'Completado',      dot: 'bg-green-500',   color: 'text-green-700 dark:text-green-300',    bg: 'bg-green-50 hover:bg-green-100 dark:bg-green-900/30 dark:hover:bg-green-900/50',       ring: 'ring-green-400'   },
  { status: 'cancelled',           label: 'Cancelado',       dot: 'bg-red-500',     color: 'text-red-700 dark:text-red-300',        bg: 'bg-red-50 hover:bg-red-100 dark:bg-red-900/30 dark:hover:bg-red-900/50',               ring: 'ring-red-400'     },
]

export default function OrdersPage() {
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<OrderStatus | 'all'>('all')
  const [page, setPage]     = useState(1)

  const { data, isLoading } = useOrders({ page, pageSize: 20, search, status })
  const { data: stats }     = useOrderStats()

  const activeStatusLabel = STATUS_OPTIONS.find(
    (o) => o.value === status && status !== 'all'
  )?.label

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Órdenes</h1>
          <p className="text-muted-foreground">
            Gestiona las órdenes de venta y pedidos a URREA
          </p>
        </div>
        <Link href="/dashboard/orders/new">
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            Nueva Orden
          </Button>
        </Link>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {STAT_CARDS.map((card) => (
          <button
            key={card.status}
            onClick={() => {
              setStatus((s) => (s === card.status ? 'all' : card.status))
              setPage(1)
            }}
            className={`rounded-lg border p-4 text-left transition-colors cursor-pointer ${card.bg} ${
              status === card.status ? `ring-2 ring-offset-1 ${card.ring}` : ''
            }`}
          >
            <div className="flex items-center gap-2 mb-2">
              <span className={`inline-block h-2 w-2 rounded-full shrink-0 ${card.dot}`} />
              <span className={`text-xs font-medium ${card.color}`}>{card.label}</span>
            </div>
            <p className={`text-2xl font-bold ${card.color}`}>
              {stats ? stats[card.status] : '—'}
            </p>
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por nombre o cliente..."
            className="pl-10"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setPage(1)
            }}
          />
        </div>
        <Select
          value={status}
          onValueChange={(value) => {
            setStatus(value as OrderStatus | 'all')
            setPage(1)
          }}
        >
          <SelectTrigger className="w-full sm:w-56">
            <SelectValue placeholder="Filtrar por estado" />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {activeStatusLabel && (
          <button
            onClick={() => { setStatus('all'); setPage(1) }}
            className="inline-flex items-center gap-1.5 rounded-full border bg-muted px-3 py-1.5 text-sm text-foreground hover:bg-muted/70 transition-colors whitespace-nowrap"
          >
            {activeStatusLabel}
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Table */}
      <OrdersTable orders={data?.data ?? []} isLoading={isLoading} />

      {/* Pagination */}
      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Mostrando{' '}
            {(page - 1) * data.pageSize + 1}–
            {Math.min(page * data.pageSize, data.count)} de {data.count} órdenes
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
            >
              Anterior
            </Button>
            <span className="text-sm text-muted-foreground px-1">
              {page} / {data.totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))}
              disabled={page === data.totalPages}
            >
              Siguiente
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
