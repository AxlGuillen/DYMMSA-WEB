'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useSavePayrollDay } from '@/hooks/usePayroll'
import { formatDayLong } from '@/lib/format'
import { classifyDay, parseHoursInput } from '@/lib/payroll'
import { formatDuration } from '@/lib/timesheet'
import type { PayrollDay, PayrollEmployee, ProfileArea } from '@/types/database'

export interface DayTarget {
  employee: PayrollEmployee
  /** Office or workshop: decides how a Saturday counts (#135). */
  area: ProfileArea
  date: string
  day: PayrollDay | null
}

const SOURCE_LABELS: Record<PayrollDay['source'], string> = {
  sheet: 'leído de la hoja por el asistente',
  hours: 'traído de Horas',
  manual: 'capturado a mano',
}

const asInput = (minutes: number | undefined) => (minutes ? formatDuration(minutes) : '')

export function PayrollDayDialog({ target, onClose }: { target: DayTarget | null; onClose: () => void }) {
  return (
    <Dialog open={!!target} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="sm:max-w-md">
        {target && <DayFields key={`${target.employee.id}|${target.date}`} target={target} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  )
}

function DayFields({ target, onClose }: { target: DayTarget; onClose: () => void }) {
  const { employee, area, date, day } = target
  const [worked, setWorked] = useState(asInput(day?.worked_minutes))
  const [missed, setMissed] = useState(asInput(day?.missed_minutes))
  const [note, setNote] = useState(day?.note ?? '')
  const save = useSavePayrollDay()

  const workedMinutes = parseHoursInput(worked)
  const missedMinutes = parseHoursInput(missed)
  const breakdown = workedMinutes ? classifyDay(date, workedMinutes, employee.shift, area) : null
  const isSaturday = new Date(`${date}T00:00:00Z`).getUTCDay() === 6

  const submit = async (values: { worked: number; missed: number; note: string }) => {
    try {
      const result = await save.mutateAsync({
        employee_id: employee.id,
        work_date: date,
        worked_minutes: values.worked,
        missed_minutes: values.missed,
        note: values.note,
      })
      toast.success(result.deleted ? 'Día borrado' : 'Día guardado')
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo guardar')
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (workedMinutes === null || missedMinutes === null) {
      toast.error('Escribe las horas como 8, 8.5 u 8:30 (máximo 24)')
      return
    }
    void submit({ worked: workedMinutes, missed: missedMinutes, note })
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{employee.name}</DialogTitle>
        <DialogDescription>
          {formatDayLong(date)}
          {day && ` · ${day.status === 'draft' ? 'Borrador' : 'Confirmado'}, ${SOURCE_LABELS[day.source]}`}
        </DialogDescription>
      </DialogHeader>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="pd-worked">Horas trabajadas</Label>
          <Input id="pd-worked" value={worked} onChange={(e) => setWorked(e.target.value)} placeholder="8, 8.5 u 8:30" inputMode="decimal" autoFocus />
          {breakdown && (
            <p className="text-xs text-muted-foreground">
              {isSaturday && area === 'office' && 'Sábado de oficina: todo normal. Sin ir se pagan las horas de su jornada; si fue, lo mayor. '}
              {breakdown.sunday > 0 && `Domingo: cuenta triple (${formatDuration(breakdown.equivalent)}).`}
              {breakdown.regular > 0 && `${formatDuration(breakdown.regular)} normales`}
              {breakdown.extra > 0 && ` + ${formatDuration(breakdown.extra)} extra`}
              {breakdown.saturdayExtra > 0 && ` + ${formatDuration(breakdown.saturdayExtra)} al doble (${formatDuration(breakdown.equivalent)} equivalentes)`}
            </p>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="pd-missed">Horas no trabajadas</Label>
          <Input id="pd-missed" value={missed} onChange={(e) => setMissed(e.target.value)} placeholder="Vacío = ninguna" inputMode="decimal" />
          <p className="text-xs text-muted-foreground">Solo se registran; no descuentan nada.</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="pd-note">Nota</Label>
          <Input id="pd-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Opcional" />
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          {day ? (
            <Button type="button" variant="ghost" className="text-destructive" disabled={save.isPending} onClick={() => void submit({ worked: 0, missed: 0, note: '' })}>
              Borrar día
            </Button>
          ) : <span />}
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={save.isPending}>Cancelar</Button>
            <Button type="submit" disabled={save.isPending}>{save.isPending ? 'Guardando…' : day?.status === 'draft' ? 'Guardar y confirmar' : 'Guardar'}</Button>
          </div>
        </DialogFooter>
      </form>
    </>
  )
}
