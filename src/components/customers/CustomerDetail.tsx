'use client'

import Link from 'next/link'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { MetricCard } from '@/components/dashboard/MetricCard'
import { TourButton } from '@/components/tours/TourButton'
import { AlertTriangle, ArrowLeft, Clock, DollarSign, FileSpreadsheet, Mail, Phone, Printer, RefreshCw } from '@/components/icons'
import { useCustomer, useRefreshCustomers } from '@/hooks/useCustomers'
import { useCurrency } from '@/hooks/useCurrency'
import { useDateFormat } from '@/hooks/useDateFormat'
import { ApiError } from '@/lib/fetch-json'
import { formatMoney, formatRelative } from '@/lib/format'
import {
  daysLabel,
  INVOICE_STATUS_LABELS,
  rangeLabel,
  rangeQuery,
  SALE_STATE_LABELS,
  STATEMENT_FILTER_LABELS,
} from '@/lib/customers'
import { downloadStatementExcel, generateStatementExcel } from '@/lib/excel/statement'
import { cn } from '@/lib/utils'
import { OdooUnavailable } from './OdooUnavailable'
import { StatementRangeFilter, useStatementRange } from './StatementRangeFilter'

/** Discrete mode masks amounts on screen only: a printed statement with "$•,•••" is useless. */
function Amount({ value, masked }: { value: number; masked: string }) {
  return (
    <>
      <span className="print:hidden">{masked}</span>
      <span className="hidden print:inline">{formatMoney(value)}</span>
    </>
  )
}

/** Amounts are never converted (ADR-027 §7): a non-MXN line says so next to its amount. */
function CurrencyBadge({ currency }: { currency: string | null }) {
  return currency && currency !== 'MXN' ? <Badge variant="secondary" className="ml-2">{currency}</Badge> : null
}

const invoiceCount = (n: number) => `${n} factura${n === 1 ? '' : 's'}`
const unconverted = (currencies: string[] | undefined) =>
  currencies?.length ? ` · incluye ${currencies.join(', ')} sin convertir` : ''

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children ?? <span className="text-muted-foreground">—</span>}</dd>
    </div>
  )
}

export function CustomerDetail({ id }: { id: string }) {
  const [range, setRange] = useStatementRange()
  const { data, isLoading, isError, error } = useCustomer(id, range)
  const refresh = useRefreshCustomers()
  const money = useCurrency()
  const fmtDay = useDateFormat()
  const day = (iso: string | null) => (iso ? fmtDay(iso) : '—')
  const backHref = `/dashboard/clientes?${rangeQuery(range)}`

  const back = (
    <Button asChild variant="ghost" size="sm" className="print:hidden">
      <Link href={backHref}>
        <ArrowLeft className="mr-1 size-4" />
        Clientes
      </Link>
    </Button>
  )

  if (isError && error instanceof ApiError && error.status === 404) {
    return (
      <div className="space-y-4">
        {back}
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Cliente no encontrado: no está en la lista de clientes de Odoo ni tiene facturas abiertas.
          </CardContent>
        </Card>
      </div>
    )
  }

  const loading = isLoading || refresh.isPending
  const customer = data?.customer
  const statement = data?.statement
  const totals = statement?.totals
  const unavailable = !loading && (isError || (data && data.customer === null))

  const handleRefresh = () =>
    refresh.mutate(undefined, {
      onError: (err) => toast.error(err instanceof Error ? err.message : 'No se pudo actualizar'),
    })

  const handleExcel = () => {
    if (!customer || !statement || !data) return
    const blob = generateStatementExcel({
      customerName: customer.name,
      range: data.range,
      today: data.today,
      lines: statement.lines,
      totals: statement.totals,
      currencies: statement.currencies,
      truncated: data.truncated,
    })
    downloadStatementExcel(blob, customer.name, data.today)
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 print:hidden">
        <div>{back}</div>
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            {!customer && loading ? (
              <Skeleton className="h-9 w-64" />
            ) : (
              <h1 className="text-3xl font-semibold tracking-tight">{customer?.name ?? 'Cliente'}</h1>
            )}
            {customer?.city && <p className="text-muted-foreground">{customer.city}</p>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <TourButton tour="customer-detail" />
            {data?.fetchedAt && <span className="text-xs text-muted-foreground">Actualizado {formatRelative(data.fetchedAt)}</span>}
            <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refresh.isPending} aria-label="Actualizar cliente">
              <RefreshCw className={cn('mr-1 size-3.5', refresh.isPending && 'animate-spin')} />
              Actualizar
            </Button>
          </div>
        </div>
      </div>

      {/* What the printed page carries: name, window and cut-off date only — no RFC or contact (decision 2026-10-15). */}
      {customer && data && (
        <div className="hidden space-y-1 print:block">
          <h1 className="text-2xl font-semibold">Estado de cuenta</h1>
          <p className="text-lg">{customer.name}</p>
          <p className="text-sm">{rangeLabel(data.range, fmtDay)} · {STATEMENT_FILTER_LABELS[data.range.filter]}</p>
          <p className="text-sm">Fecha de corte: {fmtDay(data.today)}</p>
          {statement?.currencies.length ? (
            <p className="text-sm">Montos en su moneda original; los totales incluyen {statement.currencies.join(', ')} sin convertir.</p>
          ) : null}
          {data.truncated && <p className="text-sm">Odoo devolvió el máximo de registros: puede faltar alguna factura.</p>}
        </div>
      )}

      <StatementRangeFilter range={range} onChange={setRange} />

      {unavailable ? (
        <OdooUnavailable reason={data?.reason ?? null} failed={isError} />
      ) : (
        <>
          <Card className="print:hidden" data-tour="cli-contact">
            <CardContent className="p-4">
              {loading || !customer ? (
                <Skeleton className="h-10 w-full" />
              ) : (
                <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <Field label="Teléfono">
                    {customer.phone && (
                      <a href={`tel:${customer.phone}`} className="inline-flex items-center gap-1 hover:underline">
                        <Phone className="size-3.5" />
                        {customer.phone}
                      </a>
                    )}
                  </Field>
                  <Field label="Correo">
                    {customer.email && (
                      <a href={`mailto:${customer.email}`} className="inline-flex items-center gap-1 break-all hover:underline">
                        <Mail className="size-3.5" />
                        {customer.email}
                      </a>
                    )}
                  </Field>
                  <Field label="RFC">{customer.vat && <span className="font-mono">{customer.vat}</span>}</Field>
                  <Field label="Días de cobro (promedio Odoo)">
                    {customer.daysToPay !== null && `${Math.round(customer.daysToPay)} días`}
                  </Field>
                </dl>
              )}
            </CardContent>
          </Card>

          <div className="grid gap-4 sm:grid-cols-3 print:hidden" data-tour="cli-statement-totals">
            <MetricCard
              title="Vencido"
              value={money(totals?.overdue ?? 0)}
              description={totals ? `${invoiceCount(totals.overdueCount)}${unconverted(statement?.currencies)}` : undefined}
              icon={<AlertTriangle className="size-4" />}
              color="red"
              isLoading={loading}
            />
            <MetricCard
              title="Por vencer"
              value={money(totals?.upcoming ?? 0)}
              description={totals ? `${invoiceCount(totals.upcomingCount)}${unconverted(statement?.currencies)}` : undefined}
              icon={<Clock className="size-4" />}
              color="orange"
              isLoading={loading}
            />
            <MetricCard
              title="Total por cobrar"
              value={money(totals?.total ?? 0)}
              description={totals ? `${invoiceCount(totals.count)} en el rango${unconverted(statement?.currencies)}` : undefined}
              icon={<DollarSign className="size-4" />}
              color="blue"
              isLoading={loading}
            />
          </div>

          {data?.truncated && (
            <p className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-400 print:hidden" role="status">
              <AlertTriangle className="size-4" />
              Odoo devolvió el máximo de registros: puede faltar alguna factura.
            </p>
          )}

          <Card data-tour="cli-statement" className="print:border-0 print:shadow-none">
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 print:hidden">
              <CardTitle className="text-base">Estado de cuenta</CardTitle>
              <div className="flex gap-2" data-tour="cli-export">
                <Button variant="outline" size="sm" onClick={handleExcel} disabled={!statement?.lines.length}>
                  <FileSpreadsheet className="mr-1 size-4" />
                  Excel
                </Button>
                <Button variant="outline" size="sm" onClick={() => window.print()} disabled={!statement?.lines.length}>
                  <Printer className="mr-1 size-4" />
                  Imprimir
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0 print:p-0">
              {loading ? (
                <div className="space-y-2 p-4">
                  {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-8 w-full" />)}
                </div>
              ) : !statement?.lines.length ? (
                <p className="p-6 text-center text-sm text-muted-foreground">Sin facturas abiertas en este rango.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Folio</TableHead>
                      <TableHead>Fecha de factura</TableHead>
                      <TableHead>Vencimiento</TableHead>
                      <TableHead>Estado</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead className="text-right">Saldo</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {statement.lines.map((l) => (
                      <TableRow key={l.id}>
                        <TableCell className="font-medium">{l.folio}</TableCell>
                        <TableCell className="tabular-nums">{day(l.invoiceDate)}</TableCell>
                        <TableCell className="tabular-nums">{day(l.dueDate)}</TableCell>
                        <TableCell>
                          <Badge variant={l.status === 'overdue' ? 'destructive' : 'secondary'}>
                            {l.status === 'overdue' ? 'Vencida' : 'Por vencer'}
                          </Badge>
                          <span className="ml-2 text-xs text-muted-foreground">{daysLabel(l)}</span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums"><Amount value={l.total} masked={money(l.total)} /></TableCell>
                        <TableCell className="text-right font-medium tabular-nums">
                          <Amount value={l.residual} masked={money(l.residual)} />
                          <CurrencyBadge currency={l.currency} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                  {totals && (
                    <TableFooter>
                      <TableRow>
                        <TableCell colSpan={5}>Vencido</TableCell>
                        <TableCell className="text-right tabular-nums"><Amount value={totals.overdue} masked={money(totals.overdue)} /></TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell colSpan={5}>Por vencer</TableCell>
                        <TableCell className="text-right tabular-nums"><Amount value={totals.upcoming} masked={money(totals.upcoming)} /></TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell colSpan={5} className="font-semibold">Total por cobrar</TableCell>
                        <TableCell className="text-right font-semibold tabular-nums"><Amount value={totals.total} masked={money(totals.total)} /></TableCell>
                      </TableRow>
                    </TableFooter>
                  )}
                </Table>
              )}
            </CardContent>
          </Card>

          {data?.creditNotes && data.creditNotes.count > 0 && (
            <Card className="print:hidden" data-tour="cli-credit-notes">
              <CardHeader>
                <CardTitle className="text-base">
                  Notas de crédito sin aplicar · {money(data.creditNotes.total)}{unconverted(data.creditNotes.currencies)}
                </CardTitle>
                <p className="text-sm text-muted-foreground">Saldo a favor del cliente. No se resta de lo que debe: no se sabe si la usará.</p>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Folio</TableHead>
                      <TableHead>Fecha</TableHead>
                      <TableHead className="text-right">Saldo</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.creditNotes.lines.map((n) => (
                      <TableRow key={n.id}>
                        <TableCell className="font-medium">{n.folio}</TableCell>
                        <TableCell className="tabular-nums">{day(n.date)}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {money(n.residual)}
                          <CurrencyBadge currency={n.currency} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          <div className="grid gap-4 lg:grid-cols-2 print:hidden" data-tour="cli-activity">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Ventas recientes</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {loading ? (
                  <Skeleton className="m-4 h-24" />
                ) : !data?.sales?.length ? (
                  <p className="p-6 text-center text-sm text-muted-foreground">Sin ventas registradas en Odoo.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Folio</TableHead>
                        <TableHead>Fecha</TableHead>
                        <TableHead>Estado</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.sales.map((s) => (
                        <TableRow key={s.id}>
                          <TableCell className="font-medium">{s.folio}</TableCell>
                          <TableCell className="tabular-nums">{day(s.date)}</TableCell>
                          <TableCell className="text-sm">
                            {SALE_STATE_LABELS[s.state] ?? s.state}
                            {s.invoiceStatus && (
                              <div className="text-xs text-muted-foreground">{INVOICE_STATUS_LABELS[s.invoiceStatus] ?? s.invoiceStatus}</div>
                            )}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{money(s.total)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Pagos recibidos</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {loading ? (
                  <Skeleton className="m-4 h-24" />
                ) : !data?.payments?.length ? (
                  <p className="p-6 text-center text-sm text-muted-foreground">Sin pagos registrados en Odoo.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Folio</TableHead>
                        <TableHead>Fecha</TableHead>
                        <TableHead className="text-right">Monto</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.payments.map((p) => (
                        <TableRow key={p.id}>
                          <TableCell>
                            <span className="font-medium">{p.folio}</span>
                            {p.memo && <div className="text-xs text-muted-foreground">{p.memo}</div>}
                          </TableCell>
                          <TableCell className="tabular-nums">{day(p.date)}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {money(p.amount)}
                            <CurrencyBadge currency={p.currency} />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  )
}
