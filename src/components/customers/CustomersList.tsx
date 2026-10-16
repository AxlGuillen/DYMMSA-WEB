'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { MetricCard } from '@/components/dashboard/MetricCard'
import { AlertTriangle, Clock, DollarSign, HandCoins, RefreshCw, Search } from '@/components/icons'
import { useCustomers, useRefreshCustomers } from '@/hooks/useCustomers'
import { useCurrency } from '@/hooks/useCurrency'
import { formatRelative } from '@/lib/format'
import { customersTotals, rangeQuery } from '@/lib/customers'
import { cn } from '@/lib/utils'
import { OdooUnavailable } from './OdooUnavailable'
import { StatementRangeFilter, useStatementRange } from './StatementRangeFilter'

const invoices = (n: number) => `${n} factura${n === 1 ? '' : 's'}`
const unconverted = (currencies: string[] | undefined) =>
  currencies?.length ? ` · incluye ${currencies.join(', ')} sin convertir` : ''

export function CustomersList() {
  const [range, setRange] = useStatementRange()
  const [search, setSearch] = useState('')
  const [onlyWithBalance, setOnlyWithBalance] = useState(true)
  const { data, isLoading, isError } = useCustomers(range)
  const refresh = useRefreshCustomers()
  const money = useCurrency()

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase()
    return (data?.customers ?? []).filter(
      (c) =>
        (!onlyWithBalance || c.openInvoices > 0 || c.creditNoteCount > 0) &&
        (!term || c.name.toLowerCase().includes(term) || (c.city ?? '').toLowerCase().includes(term)),
    )
  }, [data?.customers, search, onlyWithBalance])
  const visibleTotals = customersTotals(rows)
  const totals = data?.totals
  const loading = isLoading || refresh.isPending
  const unavailable = !loading && (isError || (data && data.customers === null))

  const handleRefresh = () =>
    refresh.mutate(undefined, {
      onError: (err) => toast.error(err instanceof Error ? err.message : 'No se pudo actualizar'),
    })

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <StatementRangeFilter range={range} onChange={setRange} />
        <div className="flex items-center gap-2 text-xs text-muted-foreground" data-tour="cli-refresh">
          {data?.fetchedAt && <span>Actualizado {formatRelative(data.fetchedAt)}</span>}
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refresh.isPending} aria-label="Actualizar clientes">
            <RefreshCw className={cn('mr-1 size-3.5', refresh.isPending && 'animate-spin')} />
            Actualizar
          </Button>
        </div>
      </div>

      {unavailable ? (
        <OdooUnavailable reason={data?.reason ?? null} failed={isError} />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" data-tour="cli-totals">
            <MetricCard
              title="Vencido"
              value={money(totals?.overdue ?? 0)}
              description="Ya pasó su fecha de vencimiento"
              icon={<AlertTriangle className="size-4" />}
              color="red"
              isLoading={loading}
            />
            <MetricCard
              title="Por vencer"
              value={money(totals?.upcoming ?? 0)}
              description="Vence hoy o después, dentro del rango"
              icon={<Clock className="size-4" />}
              color="orange"
              isLoading={loading}
            />
            <MetricCard
              title="Total por cobrar"
              value={money(totals?.total ?? 0)}
              description={totals ? `${invoices(totals.openInvoices)}${unconverted(totals.currencies)}` : undefined}
              icon={<DollarSign className="size-4" />}
              color="blue"
              isLoading={loading}
            />
            <MetricCard
              title="Notas de crédito sin aplicar"
              value={money(totals?.creditNotes ?? 0)}
              description="Saldo a favor de clientes; no se resta"
              icon={<HandCoins className="size-4" />}
              color="purple"
              isLoading={loading}
            />
          </div>

          {data?.truncated && (
            <p className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-400" role="status">
              <AlertTriangle className="size-4" />
              Odoo devolvió el máximo de registros: puede faltar algún cliente o factura.
            </p>
          )}

          <div className="flex flex-wrap items-center gap-3" data-tour="cli-search">
            <div className="relative w-full max-w-xs">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar cliente o ciudad…"
                aria-label="Buscar cliente"
                className="pl-8"
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4"
                checked={onlyWithBalance}
                onChange={(e) => setOnlyWithBalance(e.target.checked)}
              />
              Solo con saldo
            </label>
          </div>

          <Card data-tour="cli-table">
            <CardContent className="p-0">
              {loading ? (
                <div className="space-y-2 p-4">
                  {Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-8 w-full" />)}
                </div>
              ) : rows.length === 0 ? (
                <p className="p-6 text-center text-sm text-muted-foreground">
                  {search.trim()
                    ? 'Ningún cliente coincide con la búsqueda.'
                    : onlyWithBalance ? 'Ningún cliente tiene saldo en este rango.' : 'No hay clientes.'}
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Cliente</TableHead>
                      <TableHead className="text-right">Facturas</TableHead>
                      <TableHead className="text-right">Vencido</TableHead>
                      <TableHead className="text-right">Por vencer</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead className="text-right">Notas de crédito</TableHead>
                      <TableHead className="text-right" title="Promedio de días que tarda en pagar, según Odoo">Días de cobro</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell>
                          <Link href={`/dashboard/clientes/${c.id}?${rangeQuery(range)}`} className="font-medium hover:underline">
                            {c.name}
                          </Link>
                          {c.city && <div className="text-xs text-muted-foreground">{c.city}</div>}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{c.openInvoices}</TableCell>
                        <TableCell className={cn('text-right tabular-nums', c.overdue > 0 && 'font-medium text-red-600 dark:text-red-400')}>
                          {money(c.overdue)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{money(c.upcoming)}</TableCell>
                        <TableCell className="text-right font-medium tabular-nums">
                          {money(c.total)}
                          {c.currencies.map((cur) => <Badge key={cur} variant="secondary" className="ml-2">{cur}</Badge>)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {c.creditNoteCount > 0 ? money(c.creditNotes) : '—'}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {c.daysToPay === null ? '—' : Math.round(c.daysToPay)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                  <TableFooter>
                    <TableRow>
                      <TableCell>Total ({rows.length} cliente{rows.length === 1 ? '' : 's'})</TableCell>
                      <TableCell className="text-right tabular-nums">{visibleTotals.openInvoices}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(visibleTotals.overdue)}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(visibleTotals.upcoming)}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(visibleTotals.total)}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(visibleTotals.creditNotes)}</TableCell>
                      <TableCell />
                    </TableRow>
                  </TableFooter>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
