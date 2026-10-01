'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { CalendarOff, Trash2 } from '@/components/icons'
import { useProfiles } from '@/hooks/useProfile'
import { useCreateExcusedDay, useDeleteExcusedDay, useExcusedDays } from '@/hooks/useExcusedDays'
import { useDateFormat } from '@/hooks/useDateFormat'
import { todayInMexico } from '@/lib/format'
import { shiftDays } from '@/lib/month'
import { EXCUSE_LABELS } from '@/lib/timesheet'
import type { ExcuseKind } from '@/types/database'

/** Radix rejects value="" in SelectItem; sentinel for "the whole team". */
const WHOLE_TEAM = '__team__'
const HISTORY_DAYS = 60

/** Admin: holidays and authorized early exits, so those days never read as missing hours. */
export function ExcusedDaysPanel() {
  const today = todayInMexico()
  const { data: days, isLoading } = useExcusedDays(shiftDays(today, -HISTORY_DAYS))
  const { data: profiles } = useProfiles()
  const create = useCreateExcusedDay()
  const remove = useDeleteExcusedDay()
  const fmtDay = useDateFormat()

  const [date, setDate] = useState(today)
  const [kind, setKind] = useState<ExcuseKind>('holiday')
  const [person, setPerson] = useState(WHOLE_TEAM)
  const [note, setNote] = useState('')

  const names = new Map((profiles ?? []).map((p) => [p.id, p.display_name]))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      await create.mutateAsync({ work_date: date, kind, user_id: person === WHOLE_TEAM ? null : person, note: note.trim() || null })
      toast.success('Día justificado')
      setNote('')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo guardar')
    }
  }

  const handleRemove = async (id: string) => {
    try {
      await remove.mutateAsync(id)
      toast.success('Día quitado')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo quitar')
    }
  }

  return (
    <Card data-tour="team-excused">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarOff className="size-4" />
          Días feriados y salidas autorizadas
        </CardTitle>
        <CardDescription>
          No cuentan como horas faltantes: un <b>día feriado</b> no pide horas y una <b>salida autorizada</b> da el día por cumplido con lo que se trabajó.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={handleSubmit} className="grid gap-3 sm:grid-cols-[auto_auto_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
          <div className="space-y-1">
            <Label htmlFor="ex-date">Fecha</Label>
            <Input id="ex-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ex-kind">Tipo</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as ExcuseKind)}>
              <SelectTrigger id="ex-kind" className="min-w-[170px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(EXCUSE_LABELS) as ExcuseKind[]).map((k) => (
                  <SelectItem key={k} value={k}>{EXCUSE_LABELS[k]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="ex-person">Para</Label>
            <Select value={person} onValueChange={setPerson}>
              <SelectTrigger id="ex-person"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={WHOLE_TEAM}>Todo el equipo</SelectItem>
                {(profiles ?? []).map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.display_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="ex-note">Nota</Label>
            <Input id="ex-note" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="Opcional, ej. 16 de septiembre" />
          </div>
          <Button type="submit" disabled={create.isPending}>{create.isPending ? 'Guardando…' : 'Agregar'}</Button>
        </form>

        {isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : !days || days.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin días justificados en los últimos {HISTORY_DAYS} días.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Para</TableHead>
                <TableHead>Nota</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {days.map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="tabular-nums">{fmtDay(d.work_date)}</TableCell>
                  <TableCell>{EXCUSE_LABELS[d.kind]}</TableCell>
                  <TableCell>{d.user_id ? names.get(d.user_id) ?? '—' : 'Todo el equipo'}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{d.note ?? '—'}</TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 text-destructive"
                      onClick={() => handleRemove(d.id)}
                      disabled={remove.isPending}
                      aria-label={`Quitar ${fmtDay(d.work_date)}`}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
