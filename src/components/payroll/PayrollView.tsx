'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ChevronLeft, ChevronRight, Users } from '@/components/icons'
import { PayrollDayDialog, type DayTarget } from '@/components/payroll/PayrollDayDialog'
import { PayrollEmployeesDialog } from '@/components/payroll/PayrollEmployeesDialog'
import {
  useConfirmPayroll,
  usePayrollPeriod,
  usePrefillPayroll,
  useSetPayrollClosed,
} from '@/hooks/usePayroll'
import { useDateFormat } from '@/hooks/useDateFormat'
import { formatDayMonth, todayInMexico } from '@/lib/format'
import { PERIOD_DAY_LABELS, payrollPeriod, shiftPeriod } from '@/lib/payroll'
import { formatDuration } from '@/lib/timesheet'

const errorText = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback)
const hours = (minutes: number) => (minutes > 0 ? formatDuration(minutes) : '—')

/** The Saturday→Friday cut: people × days, with the totals as they are paid. */
export function PayrollView() {
  const formatDate = useDateFormat()
  const thisPeriod = payrollPeriod(todayInMexico()).start
  const [start, setStart] = useState(thisPeriod)
  const [target, setTarget] = useState<DayTarget | null>(null)
  const [employeesOpen, setEmployeesOpen] = useState(false)

  const { data: view, isLoading, isError } = usePayrollPeriod(start)
  const prefill = usePrefillPayroll()
  const confirm = useConfirmPayroll()
  const setClosed = useSetPayrollClosed()
  const busy = prefill.isPending || confirm.isPending || setClosed.isPending

  const handlePrefill = async () => {
    try {
      const result = await prefill.mutateAsync(start)
      if (result.linked === 0) {
        toast.info('Nadie está ligado a un perfil', { description: 'Liga a la gente de oficina desde Empleados.' })
        return
      }
      const notes = [
        result.skipped.length > 0 ? `No se tocaron (ya capturados): ${[...new Set(result.skipped.map((s) => formatDayMonth(s.work_date)))].join(', ')}` : null,
        result.open > 0 ? `${result.open} checadas sin salida no suman: corrígelas en Horas y vuelve a traer` : null,
      ].filter(Boolean)
      toast.success(`${result.saved} días traídos de Horas como borrador`, { description: notes.join(' · ') || undefined })
    } catch (err) {
      toast.error(errorText(err, 'No se pudieron traer las horas'))
    }
  }

  const handleConfirm = async () => {
    try {
      const { confirmed } = await confirm.mutateAsync(start)
      toast.success(`${confirmed} días confirmados`)
    } catch (err) {
      toast.error(errorText(err, 'No se pudieron confirmar'))
    }
  }

  const handleClosed = async (closed: boolean) => {
    try {
      await setClosed.mutateAsync({ start, closed })
      toast.success(closed ? 'Corte cerrado' : 'Corte reabierto')
    } catch (err) {
      toast.error(errorText(err, 'No se pudo actualizar el corte'))
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="icon" className="size-8" onClick={() => setStart((s) => shiftPeriod(s, -1))} aria-label="Corte anterior">
          <ChevronLeft className="size-4" />
        </Button>
        <span className="min-w-[220px] text-center text-sm font-medium">
          {formatDate(start)} – {formatDate(payrollPeriod(start).end)}
        </span>
        <Button variant="outline" size="icon" className="size-8" onClick={() => setStart((s) => shiftPeriod(s, 1))} aria-label="Corte siguiente">
          <ChevronRight className="size-4" />
        </Button>
        {start !== thisPeriod && (
          <Button variant="ghost" size="sm" onClick={() => setStart(thisPeriod)}>Corte actual</Button>
        )}
        {view?.closed && <Badge>Cerrado</Badge>}

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setEmployeesOpen(true)}>
            <Users className="mr-2 size-4" />
            Empleados
          </Button>
          {view && !view.closed && (
            <>
              <Button variant="outline" size="sm" onClick={handlePrefill} disabled={busy}>Traer de Horas</Button>
              <Button variant="outline" size="sm" onClick={handleConfirm} disabled={busy || view.drafts === 0}>
                Confirmar borradores{view.drafts > 0 ? ` (${view.drafts})` : ''}
              </Button>
              <Button size="sm" onClick={() => handleClosed(true)} disabled={busy || view.drafts > 0}>Cerrar corte</Button>
            </>
          )}
          {view?.closed && (
            <Button variant="outline" size="sm" onClick={() => handleClosed(false)} disabled={busy}>Reabrir corte</Button>
          )}
        </div>
      </div>

      {view?.closed && view.period?.closed_at && (
        <p className="text-xs text-muted-foreground">
          Cerrado por {view.period.closed_by_name ?? 'un administrador'} el {formatDate(view.period.closed_at.slice(0, 10))}. Las horas ya no cambian.
        </p>
      )}

      {isLoading && <Skeleton className="h-64 w-full" />}
      {isError && (
        <Card><CardContent className="pt-6 text-sm text-muted-foreground">No se pudo cargar el corte.</CardContent></Card>
      )}

      {view && view.rows.length === 0 && (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            Aún no hay empleados en Nómina. Agrégalos desde <strong>Empleados</strong>; los de oficina se ligan a su perfil para traer sus horas.
          </CardContent>
        </Card>
      )}

      {view && view.rows.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Empleado</TableHead>
                  {view.dates.map((date, i) => (
                    <TableHead key={date} className="text-center">
                      {PERIOD_DAY_LABELS[i]}
                      <span className="block text-[11px] font-normal text-muted-foreground">
                        {formatDayMonth(date)}{i === 0 ? ' · ×2' : i === 1 ? ' · ×3' : ''}
                      </span>
                    </TableHead>
                  ))}
                  <TableHead className="text-right">Normal</TableHead>
                  <TableHead className="text-right">Extra</TableHead>
                  <TableHead className="text-right">Sáb</TableHead>
                  <TableHead className="text-right">Dom</TableHead>
                  <TableHead className="text-right">Equivalente</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {view.rows.map((row) => (
                  <TableRow key={row.employee.id}>
                    <TableCell className="font-medium">
                      {row.employee.name}
                      {!row.employee.active && <span className="ml-2 text-xs italic text-muted-foreground">inactivo</span>}
                    </TableCell>
                    {row.days.map((day, i) => (
                      <TableCell key={view.dates[i]} className="p-1 text-center">
                        <button
                          type="button"
                          disabled={view.closed}
                          onClick={() => setTarget({ employee: row.employee, date: view.dates[i], day })}
                          aria-label={`${row.employee.name}, ${PERIOD_DAY_LABELS[i]} ${formatDayMonth(view.dates[i])}`}
                          className={`w-full rounded-md px-2 py-1.5 text-sm tabular-nums transition-colors enabled:hover:cursor-pointer enabled:hover:bg-muted ${
                            day?.status === 'draft' ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400' : ''
                          }`}
                        >
                          {day ? formatDuration(day.worked_minutes) : <span className="text-muted-foreground">—</span>}
                          {day?.status === 'draft' && <span className="block text-[10px] leading-none">borrador</span>}
                        </button>
                      </TableCell>
                    ))}
                    <TableCell className="text-right tabular-nums">{hours(row.totals.regular)}</TableCell>
                    <TableCell className="text-right tabular-nums">{hours(row.totals.extra)}</TableCell>
                    <TableCell className="text-right tabular-nums">{hours(row.totals.saturday)}</TableCell>
                    <TableCell className="text-right tabular-nums">{hours(row.totals.sunday)}</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">{hours(row.totals.equivalent)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={8} className="text-right text-sm">Total del corte</TableCell>
                  <TableCell className="text-right tabular-nums">{hours(view.totals.regular)}</TableCell>
                  <TableCell className="text-right tabular-nums">{hours(view.totals.extra)}</TableCell>
                  <TableCell className="text-right tabular-nums">{hours(view.totals.saturday)}</TableCell>
                  <TableCell className="text-right tabular-nums">{hours(view.totals.sunday)}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{hours(view.totals.equivalent)}</TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </CardContent>
        </Card>
      )}

      {view && view.rows.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Equivalente = normal + extra + sábado ×2 + domingo ×3. Los borradores (en ámbar) no suman hasta confirmarse.
        </p>
      )}

      <PayrollDayDialog target={target} onClose={() => setTarget(null)} />
      <PayrollEmployeesDialog open={employeesOpen} onClose={() => setEmployeesOpen(false)} />
    </div>
  )
}
