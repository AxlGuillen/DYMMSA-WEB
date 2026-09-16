'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { useCreateTimeEntry, useUpdateTimeEntry, useDeleteTimeEntry } from '@/hooks/useTimeEntries'
import type { TimeEntry } from '@/types/database'

interface TimeEntryFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Existing pair to correct; absent = manual capture. */
  entry?: TimeEntry | null
  /** Target user and day for a manual capture. */
  userId: string
  date?: string
}

export function TimeEntryForm({ open, onOpenChange, entry, userId, date }: TimeEntryFormProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {/* Remounts per target so the fields start from the right values without an effect. */}
        <EntryFields key={entry?.id ?? date ?? 'new'} entry={entry} userId={userId} date={date} onOpenChange={onOpenChange} />
      </DialogContent>
    </Dialog>
  )
}

function EntryFields({ entry, userId, date, onOpenChange }: Omit<TimeEntryFormProps, 'open'>) {
  const [workDate, setWorkDate] = useState(entry?.work_date ?? date ?? '')
  const [clockIn, setClockIn] = useState(entry?.clock_in ?? '')
  const [clockOut, setClockOut] = useState(entry?.clock_out ?? '')
  const [note, setNote] = useState(entry?.note ?? '')
  const [confirmDelete, setConfirmDelete] = useState(false)

  const create = useCreateTimeEntry()
  const update = useUpdateTimeEntry()
  const remove = useDeleteTimeEntry()
  const isPending = create.isPending || update.isPending || remove.isPending

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!clockIn) {
      toast.error('Captura la hora de entrada')
      return
    }
    if (clockOut && clockOut < clockIn) {
      toast.error('La salida no puede ser antes de la entrada')
      return
    }
    try {
      if (entry) {
        await update.mutateAsync({ id: entry.id, updates: { clock_in: clockIn, clock_out: clockOut || null, note: note || null } })
        toast.success('Checada corregida')
      } else {
        await create.mutateAsync({ user_id: userId, work_date: workDate, clock_in: clockIn, clock_out: clockOut || null, note: note || null })
        toast.success('Checada registrada')
      }
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo guardar')
    }
  }

  const handleDelete = async () => {
    if (!entry) return
    try {
      await remove.mutateAsync(entry.id)
      toast.success('Checada eliminada')
      setConfirmDelete(false)
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo eliminar')
    }
  }

  return (
    <>
          <DialogHeader>
            <DialogTitle>{entry ? 'Corregir checada' : 'Registrar checada'}</DialogTitle>
            <DialogDescription>
              {entry
                ? 'La corrección queda registrada con tu nombre; lo que dijo el checador se conserva.'
                : 'Captura manual; un reporte posterior del checador la reconcilia si no fue editada.'}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="te-date">Fecha</Label>
              <Input id="te-date" type="date" value={workDate} onChange={(e) => setWorkDate(e.target.value)} disabled={!!entry} required />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="te-in">Entrada</Label>
                <Input id="te-in" type="time" value={clockIn} onChange={(e) => setClockIn(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="te-out">Salida</Label>
                <Input id="te-out" type="time" value={clockOut} onChange={(e) => setClockOut(e.target.value)} />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="te-note">Nota</Label>
              <Input id="te-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Opcional" maxLength={200} />
            </div>
            {entry?.original && (
              <p className="text-xs text-muted-foreground">
                El checador decía {entry.original.clock_in}–{entry.original.clock_out ?? 'sin salida'}
              </p>
            )}
            <DialogFooter className="gap-2 sm:justify-between">
              {entry ? (
                <Button type="button" variant="destructive" size="sm" onClick={() => setConfirmDelete(true)} disabled={isPending}>
                  Eliminar
                </Button>
              ) : <span />}
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={isPending}>
                  {isPending ? 'Guardando…' : 'Guardar'}
                </Button>
              </div>
            </DialogFooter>
          </form>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar esta checada?</AlertDialogTitle>
            <AlertDialogDescription>
              Se borra del historial. Si el checador la vuelve a reportar, un nuevo import la restaura.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={isPending}>Eliminar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
