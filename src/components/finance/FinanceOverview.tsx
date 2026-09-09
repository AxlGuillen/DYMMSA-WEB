'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { MetricCard } from '@/components/dashboard/MetricCard'
import { Badge } from '@/components/ui/badge'
import { ChevronLeft, ChevronRight, DollarSign, AlertTriangle, Clock, Check, Receipt, RefreshCw } from '@/components/icons'
import { toast } from 'sonner'
import { usePayablesOverview } from '@/hooks/usePayables'
import { useIncomeOverview, useRefreshIncome } from '@/hooks/useIncome'
import { useCurrency } from '@/hooks/useCurrency'
import { formatRelative, todayInMexico } from '@/lib/format'
import { useDateFormat } from '@/hooks/useDateFormat'
import { monthOf, weekOfMonth } from '@/lib/payables'
import { monthClosing } from '@/lib/income'

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
  const incomeQuery = useIncomeOverview(month)
  const refreshIncome = useRefreshIncome()
  const fmt = useCurrency()
  const fmtDay = useDateFormat()

  const summary = data?.summary
  const incomeData = incomeQuery.data
  const income = incomeData?.income ?? null
  const incomeLoading = incomeQuery.isLoading || refreshIncome.isPending
  // A failed GET is not "Odoo degraded": data is undefined, not income: null (review PR #98).
  const incomeUnavailable = !incomeLoading && (incomeQuery.isError || (!!incomeData && !income))
  // Overdue carry-over from earlier months still has to be paid: it belongs in the projection (PR #98).
  const closing = income && summary
    ? monthClosing({
        collected: income.collectedTotal,
        paid: summary.paidTotal,
        pending: summary.pendingTotal + summary.carryOverTotal,
      })
    : null
  const currencies = income?.collectionCurrencies ?? []
  const receivableNote = income?.receivableCurrencies.length
    ? ` · incluye ${income.receivableCurrencies.join(', ')} sin convertir`
    : ''

  const handleRefresh = () => {
    refreshIncome.mutate(month, {
      onError: (err) => toast.error(err instanceof Error ? err.message : 'No se pudo actualizar'),
    })
  }
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

      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Egresos</h2>
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

      <div className="flex flex-wrap items-center justify-between gap-2" data-testid="income-header">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Ingresos (Odoo)</h2>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {currencies.length > 0 && (
            <Badge variant="outline">Incluye {currencies.join(', ')} sin convertir</Badge>
          )}
          {incomeData?.fetchedAt && <span>Actualizado {formatRelative(incomeData.fetchedAt)}</span>}
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshIncome.isPending} aria-label="Actualizar ingresos">
            <RefreshCw className={`mr-1 size-3.5 ${refreshIncome.isPending ? 'animate-spin' : ''}`} />
            Actualizar
          </Button>
        </div>
      </div>

      {incomeUnavailable ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="size-4 text-amber-600" />
              Ingresos no disponibles
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {incomeQuery.isError
              ? 'No se pudieron cargar los ingresos. Intenta de nuevo con Actualizar.'
              : incomeData?.unavailable?.message ?? 'No se pudo leer Odoo.'}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            title="Cobrado del mes"
            value={fmt(income?.collectedTotal ?? 0)}
            description={income ? `${income.collectedCount} cobro${income.collectedCount !== 1 ? 's' : ''}` : undefined}
            icon={<Check className="size-5" />}
            color="green"
            isLoading={incomeLoading}
          />
          <MetricCard
            title="Por cobrar"
            value={fmt(income?.receivableTotal ?? 0)}
            description={income ? `${pieces(income.receivableCount)} al día de hoy — vence hoy o después${receivableNote}` : undefined}
            icon={<Clock className="size-5" />}
            color="blue"
            isLoading={incomeLoading}
          />
          <MetricCard
            title="Vencido por cobrar"
            value={fmt(income?.overdueTotal ?? 0)}
            description={income ? `${pieces(income.overdueCount)} al día de hoy — cualquier mes${receivableNote}` : undefined}
            icon={<AlertTriangle className="size-5" />}
            color="red"
            isLoading={incomeLoading}
          />
          <MetricCard
            title="Cierre del mes"
            value={fmt(closing?.real ?? 0)}
            description={closing ? `Proyectado ${fmt(closing.projected)} · cobrado − pagado − pendientes del mes y vencidas previas` : undefined}
            icon={<DollarSign className="size-5" />}
            color="purple"
            isLoading={incomeLoading || isLoading}
          />
        </div>
      )}
      {income?.receivablesTruncated && (
        <p className="text-xs text-muted-foreground">
          Facturas abiertas: se leyeron las primeras 500; por cobrar y vencido pueden quedar cortos.
        </p>
      )}

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

      {income && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <Check className="size-4" />
              Cobros de {monthLabel(month).toLowerCase()}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {incomeData?.collections.length === 0 && (
              <p className="text-sm text-muted-foreground">Sin cobros registrados en Odoo este mes.</p>
            )}
            {incomeData?.collections.map((c) => (
              <div key={c.id} className="flex items-center justify-between rounded-md border px-3 py-1.5 text-sm">
                <span className="min-w-0 truncate">
                  <span className="font-medium">{c.customer ?? 'Sin cliente'}</span>
                  <span className="text-muted-foreground"> · {c.folio}</span>
                  {c.currency && c.currency !== 'MXN' && <Badge variant="secondary" className="ml-2">{c.currency}</Badge>}
                </span>
                <span className="ml-3 shrink-0 tabular-nums">
                  {fmtDay(c.date)} · {fmt(c.amount)}
                </span>
              </div>
            ))}
            {income.collectionsTruncated && (
              <p className="pt-1 text-xs text-muted-foreground">Se muestran los primeros 500 cobros; el total puede quedar corto.</p>
            )}
          </CardContent>
        </Card>
      )}

      <p className="text-xs text-muted-foreground">
        Ingresos leídos de Odoo por fecha de cobro (caché de 15 min). La simulación de mover
        pagos entre meses llega después.
      </p>
    </div>
  )
}
