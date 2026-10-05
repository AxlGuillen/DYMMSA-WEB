'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ChevronLeft, ChevronRight } from '@/components/icons'
import { UserAvatar } from '@/components/profile/UserAvatar'
import { useTeamHours } from '@/hooks/useTeamHours'
import { useCurrency } from '@/hooks/useCurrency'
import { useDateFormat } from '@/hooks/useDateFormat'
import { todayInMexico } from '@/lib/format'
import { formatDuration, shiftWeek, weekBounds, WEEKDAY_LABELS, type DayStatus } from '@/lib/timesheet'
import { cn } from '@/lib/utils'

/** Radix rejects value="" in SelectItem; sentinel for the whole team. */
const EVERYONE = '__all__'

const STATUS_CELL: Record<DayStatus, string> = {
  met: 'bg-green-500/10 text-green-700 dark:text-green-400',
  short: 'bg-red-500/10 text-red-600 dark:text-red-400',
  excused: 'bg-green-500/5 text-green-600 dark:text-green-500',
  open: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  pending: 'text-foreground',
  off: 'text-muted-foreground',
}

const hours = (minutes: number) => (minutes > 0 ? formatDuration(minutes) : '—')

/** Admin: one week of the office (clock) and the workshop (Nómina), for everyone or one person. */
export function TeamHoursOverview() {
  const thisWeek = weekBounds(todayInMexico()).start
  const [weekStart, setWeekStart] = useState(thisWeek)
  const [selected, setSelected] = useState(EVERYONE)
  const { data, isLoading, isError } = useTeamHours(weekStart)
  const fmt = useCurrency()
  const fmtDay = useDateFormat()

  const office = (data?.office ?? []).filter((r) => selected === EVERYONE || selected === `o:${r.id}`)
  const workshop = (data?.workshop ?? []).filter((r) => selected === EVERYONE || selected === `w:${r.id}`)
  const single = selected !== EVERYONE

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2" data-testid="team-hours-controls">
        <Button variant="outline" size="icon" className="size-8" onClick={() => setWeekStart((w) => shiftWeek(w, -1))} aria-label="Semana anterior">
          <ChevronLeft className="size-4" />
        </Button>
        <span className="min-w-[200px] text-center text-sm font-medium tabular-nums">
          {fmtDay(weekStart)} – {fmtDay(weekBounds(weekStart).end)}
        </span>
        <Button variant="outline" size="icon" className="size-8" onClick={() => setWeekStart((w) => shiftWeek(w, 1))} aria-label="Semana siguiente">
          <ChevronRight className="size-4" />
        </Button>
        {weekStart !== thisWeek && <Button variant="ghost" size="sm" onClick={() => setWeekStart(thisWeek)}>Esta semana</Button>}

        <div className="ml-auto">
          <Select value={selected} onValueChange={setSelected}>
            <SelectTrigger className="min-w-[200px]" aria-label="Persona"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={EVERYONE}>Todo el equipo</SelectItem>
              {(data?.office ?? []).map((r) => <SelectItem key={r.id} value={`o:${r.id}`}>{r.name} · oficina</SelectItem>)}
              {(data?.workshop ?? []).map((r) => <SelectItem key={r.id} value={`w:${r.id}`}>{r.name} · taller</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {isError && <p className="text-sm text-destructive">No se pudo cargar el resumen. Intenta de nuevo.</p>}

      {(!single || office.length > 0) && (
        <Card data-testid="team-office">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Oficina <span className="text-sm font-normal text-muted-foreground">· checador</span></CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0">
            {isLoading ? <Skeleton className="m-4 h-24" /> : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Persona</TableHead>
                    {WEEKDAY_LABELS.map((d) => <TableHead key={d} className="text-center">{d}</TableHead>)}
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Objetivo</TableHead>
                    <TableHead className="text-right">Pago estimado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {office.length === 0 && (
                    <TableRow><TableCell colSpan={11} className="text-center text-sm text-muted-foreground">Nadie de la oficina checa todavía.</TableCell></TableRow>
                  )}
                  {office.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>
                        <span className="flex items-center gap-2 font-medium">
                          <UserAvatar id={r.id} name={r.name} url={r.avatarUrl} size="sm" />
                          {r.name}
                        </span>
                      </TableCell>
                      {r.days.map((d) => (
                        <TableCell key={d.date} className={cn('text-center tabular-nums text-sm', STATUS_CELL[d.status])}>{hours(d.minutes)}</TableCell>
                      ))}
                      <TableCell className="text-right font-medium tabular-nums">{hours(r.minutes)}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{r.target === null ? '—' : formatDuration(r.target)}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.pay ? fmt(r.pay.amount) : <span className="italic text-muted-foreground">sin tarifa</span>}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                {!single && office.length > 0 && data && (
                  <TableFooter>
                    <TableRow>
                      <TableCell colSpan={8}>Total oficina</TableCell>
                      <TableCell className="text-right tabular-nums">{hours(data.totals.officeMinutes)}</TableCell>
                      <TableCell />
                      <TableCell className="text-right tabular-nums" data-testid="team-office-pay">{fmt(data.totals.officePay)}</TableCell>
                    </TableRow>
                  </TableFooter>
                )}
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {(!single || workshop.length > 0) && (
        <Card data-testid="team-workshop">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Taller <span className="text-sm font-normal text-muted-foreground">· hoja de Nómina</span></CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0">
            {isLoading ? <Skeleton className="m-4 h-24" /> : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Persona</TableHead>
                    {WEEKDAY_LABELS.map((d) => <TableHead key={d} className="text-center">{d}</TableHead>)}
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Borradores</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {workshop.length === 0 && (
                    <TableRow><TableCell colSpan={10} className="text-center text-sm text-muted-foreground">Sin empleados del taller en Nómina.</TableCell></TableRow>
                  )}
                  {workshop.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">{r.name}</TableCell>
                      {r.days.map((d) => (
                        <TableCell
                          key={d.date}
                          className={cn('text-center tabular-nums text-sm', d.draft && 'italic text-amber-700 dark:text-amber-400')}
                          title={d.draft ? 'Borrador: falta confirmarlo en Nómina' : undefined}
                        >
                          {hours(d.minutes)}
                        </TableCell>
                      ))}
                      <TableCell className="text-right font-medium tabular-nums">{hours(r.minutes)}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{r.drafts || '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                {!single && workshop.length > 0 && data && (
                  <TableFooter>
                    <TableRow>
                      <TableCell colSpan={8}>Total taller</TableCell>
                      <TableCell className="text-right tabular-nums">{hours(data.totals.workshopMinutes)}</TableCell>
                      <TableCell />
                    </TableRow>
                  </TableFooter>
                )}
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      <p className="text-xs text-muted-foreground">
        Semana de lunes a domingo. Verde: cumplió su jornada; rojo: no; ámbar: checada sin salida o día del taller en borrador.
        El pago de la oficina es estimado (todas las horas a su tarifa más el sábado pagado); el del taller sale del corte de Nómina.
      </p>
    </div>
  )
}
