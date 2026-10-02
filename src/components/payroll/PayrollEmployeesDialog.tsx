'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Pencil, Plus } from '@/components/icons'
import { usePayrollEmployees, useSavePayrollEmployee } from '@/hooks/usePayroll'
import { useProfiles } from '@/hooks/useProfile'
import { EMPLOYEE_NAME_MAX } from '@/lib/payroll'
import { SHIFT_LABELS, SHIFTS } from '@/lib/timesheet'
import type { PayrollEmployee, ProfileShift } from '@/types/database'

/** Radix rejects value="" in SelectItem; sentinel for "no account". */
const NO_PROFILE = '__none__'

type Editing = PayrollEmployee | 'new' | null

/** Payroll's own people: the workshop has no accounts; the office links to its profile. */
export function PayrollEmployeesDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data: employees } = usePayrollEmployees(open)
  const [editing, setEditing] = useState<Editing>(null)

  const close = () => { setEditing(null); onClose() }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) close() }}>
      <DialogContent className="sm:max-w-md">
        {editing ? (
          <EmployeeFields
            key={editing === 'new' ? 'new' : editing.id}
            employee={editing === 'new' ? null : editing}
            taken={(employees ?? []).filter((e) => e.profile_id && (editing === 'new' || e.id !== editing.id)).map((e) => e.profile_id as string)}
            onDone={() => setEditing(null)}
          />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Empleados de nómina</DialogTitle>
              <DialogDescription>
                El taller se captura con la hoja de asistencia; quien tiene cuenta en la app se liga a su perfil para traer sus horas.
              </DialogDescription>
            </DialogHeader>
            <ul className="max-h-80 divide-y overflow-y-auto rounded-md border">
              {(employees ?? []).length === 0 && (
                <li className="px-3 py-4 text-sm text-muted-foreground">Aún no hay empleados.</li>
              )}
              {(employees ?? []).map((e) => (
                <li key={e.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                  <span className={`flex-1 ${e.active ? '' : 'text-muted-foreground line-through'}`}>{e.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {e.profile_id ? 'Oficina' : 'Taller'} · {SHIFT_LABELS[e.shift]}
                  </span>
                  <Button variant="ghost" size="icon" className="size-8" onClick={() => setEditing(e)} aria-label={`Editar ${e.name}`}>
                    <Pencil className="size-4" />
                  </Button>
                </li>
              ))}
            </ul>
            <DialogFooter>
              <Button variant="outline" onClick={close}>Cerrar</Button>
              <Button onClick={() => setEditing('new')}>
                <Plus className="mr-2 size-4" />
                Agregar empleado
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

function EmployeeFields({ employee, taken, onDone }: { employee: PayrollEmployee | null; taken: string[]; onDone: () => void }) {
  const { data: profiles } = useProfiles()
  const [name, setName] = useState(employee?.name ?? '')
  const [profileId, setProfileId] = useState<string | null>(employee?.profile_id ?? null)
  const [shift, setShift] = useState<ProfileShift>(employee?.shift ?? 'full_time')
  const [active, setActive] = useState(employee?.active ?? true)
  const save = useSavePayrollEmployee()

  const pickProfile = (value: string) => {
    const id = value === NO_PROFILE ? null : value
    setProfileId(id)
    const profile = profiles?.find((p) => p.id === id)
    // Linking fills what the profile already knows; both stay editable.
    if (profile) {
      if (!name.trim()) setName(profile.display_name)
      if (profile.shift) setShift(profile.shift)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      await save.mutateAsync({ id: employee?.id, input: { name, profile_id: profileId, shift, active } })
      toast.success(employee ? 'Empleado actualizado' : 'Empleado agregado')
      onDone()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo guardar')
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{employee ? 'Editar empleado' : 'Agregar empleado'}</DialogTitle>
        <DialogDescription>
          El nombre debe coincidir con el de la hoja de asistencia: con él lo encuentra el asistente.
        </DialogDescription>
      </DialogHeader>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="pe-name">Nombre</Label>
          <Input id="pe-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={EMPLOYEE_NAME_MAX} required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="pe-profile">Perfil en la app</Label>
          <Select value={profileId ?? NO_PROFILE} onValueChange={pickProfile}>
            <SelectTrigger id="pe-profile"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_PROFILE}>Sin cuenta (taller)</SelectItem>
              {(profiles ?? []).filter((p) => !taken.includes(p.id)).map((p) => (
                <SelectItem key={p.id} value={p.id}>{p.display_name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">Con perfil, “Traer de Horas” copia sus checadas al corte.</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="pe-shift">Jornada</Label>
          <Select value={shift} onValueChange={(v) => setShift(v as ProfileShift)}>
            <SelectTrigger id="pe-shift"><SelectValue /></SelectTrigger>
            <SelectContent>
              {SHIFTS.map((s) => <SelectItem key={s} value={s}>{SHIFT_LABELS[s]}</SelectItem>)}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">Entre semana, lo que pase de 8 h (4 h en medio tiempo) cuenta como extra.</p>
        </div>
        {employee && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4" checked={active} onChange={(e) => setActive(e.target.checked)} />
            Activo (un empleado inactivo deja de aparecer en los cortes nuevos)
          </label>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onDone} disabled={save.isPending}>Volver</Button>
          <Button type="submit" disabled={save.isPending}>{save.isPending ? 'Guardando…' : 'Guardar'}</Button>
        </DialogFooter>
      </form>
    </>
  )
}
