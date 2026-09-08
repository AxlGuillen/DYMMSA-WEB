'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { MetricCard } from '@/components/dashboard/MetricCard'
import { ChevronLeft, ChevronRight, DollarSign, AlertTriangle, Clock, Check, Receipt } from '@/components/icons'
import { usePayablesOverview } from '@/hooks/usePayables'
import { useCurrency } from '@/hooks/useCurrency'
import { todayInMexico } from '@/lib/format'
import { useDateFormat } from '@/hooks/useDateFormat'
import { monthOf, weekOfMonth } from '@/lib/payables'

const MONTH_LABELS = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
]

/** 'YYYY-MM' ± n months. */
function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number)
  const total = y * 12 + (m - 1) + delta
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`
}

const monthLabel = (month: string) => {
  const [y, m] = month.split('-').map(Number)
  return `${MONTH_LABELS[m - 1]} ${y}`
}

export function FinanceOverview() {
  const [month, setMonth] = useState(() => todayInMexico().slice(0, 7))
  const { data, isLoading } = usePayablesOverview(month)
  const fmt = useCurrency()
  const fmtDay = useDateFormat()

  const summary = data?.summary
  const pieces = (n: number) => `${n} factura${n !== 1 ? 's' : ''}`

  // Pending items of the selected month, for the weekly breakdown.
  const monthPending = useMemo(
    () => (data?.payables ?? [])
      .filter((p) => p.status === 'pending' && monthOf(p.due_date) === month)
      .sort((a, b) => a.due_date.localeCompare(b.due_date)),
    [data?.payables, month],
  )

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Button variant="outline" size="icon" className="size-8" onClick={() => setMonth((m) => shiftMonth(m, -1))} aria-label="Mes anterior">
          <ChevronLeft className="size-4" />
        </Button>
        <span className="min-w-[160px] text-center text-sm font-medium">{monthLabel(month)}</span>
        <Button variant="outline" size="icon" className="size-8" onClick={() => setMonth((m) => shiftMonth(m, 1))} aria-label="Mes siguiente">
          <ChevronRight className="size-4" />
        </Button>
        {month !== todayInMexico().slice(0, 7) && (
          <Button variant="ghost" size="sm" onClick={() => setMonth(todayInMexico().slice(0, 7))}>
            Hoy
          </Button>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title="Pendiente del mes"
          value={fmt(summary?.pendingTotal ?? 0)}
          description={summary ? pieces(summary.pendingCount) : undefined}
          icon={<DollarSign className="size-5" />}
          color="blue"
          isLoading={isLoading}
        />
        <MetricCard
          title="Vencido"
          value={fmt(summary?.overdueTotal ?? 0)}
          description={summary ? `${pieces(summary.overdueCount)} — incluye meses previos` : undefined}
          icon={<AlertTriangle className="size-5" />}
          color="red"
          isLoading={isLoading}
        />
        <MetricCard
          title="Por vencer (7 días)"
          value={fmt(summary?.dueSoonTotal ?? 0)}
          description={summary ? pieces(summary.dueSoonCount) : undefined}
          icon={<Clock className="size-5" />}
          color="orange"
          isLoading={isLoading}
        />
        <MetricCard
          title="Pagado en el mes"
          value={fmt(summary?.paidTotal ?? 0)}
          description={summary ? pieces(summary.paidCount) : undefined}
          icon={<Check className="size-5" />}
          color="green"
          isLoading={isLoading}
        />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Receipt className="size-4" />
            Vencimientos de {monthLabel(month).toLowerCase()}
          </CardTitle>
          <Button asChild variant="outline" size="sm">
            <Link href="/dashboard/finance/payables">Ver todas</Link>
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {!isLoading && monthPending.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Sin facturas pendientes con vencimiento en este mes.
            </p>
          )}
          {(summary?.weeks ?? []).map((week) => (
            <div key={week.week} className="space-y-1.5">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">{week.label}</span>
                <span className="tabular-nums text-muted-foreground">
                  {fmt(week.total)} · {pieces(week.count)}
                </span>
              </div>
              <div className="space-y-1">
                {monthPending
                  .filter((p) => weekOfMonth(p.due_date) === week.week)
                  .map((p) => (
                    <div key={p.id} className="flex items-center justify-between rounded-md border px-3 py-1.5 text-sm">
                      <span className="min-w-0 truncate">
                        <span className="font-medium">{p.supplier?.name}</span>
                        <span className="text-muted-foreground"> · {p.concept}</span>
                      </span>
                      <span className="ml-3 shrink-0 tabular-nums">
                        {fmtDay(p.due_date)} · {fmt(p.amount)}
                      </span>
                    </div>
                  ))}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Fase 1: solo egresos. La proyección del cierre ± del mes (con ingresos) y la
        simulación de mover pagos entre meses llegan en la fase 2.
      </p>
    </div>
  )
}
