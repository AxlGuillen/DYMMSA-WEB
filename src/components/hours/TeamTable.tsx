'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Crown, Pencil } from '@/components/icons'
import { useProfiles, useUpdateProfile } from '@/hooks/useProfile'
import { UserAvatar } from '@/components/profile/UserAvatar'
import { NssField } from '@/components/profile/NssField'
import { useDiscreteModeStore } from '@/stores/discreteModeStore'
import { useCurrency } from '@/hooks/useCurrency'
import { maskNss, normalizeNss, nssError } from '@/lib/nss'
import { parseRate } from '@/lib/office-pay'
import { AREA_LABELS, AREAS, ROLE_LABELS } from '@/lib/profile'
import { SHIFT_LABELS, SHIFTS } from '@/lib/timesheet'
import type { ProfileArea, ProfileRole, ProfileShift, ProfileWithAvatar } from '@/types/database'

/** Radix rejects value="" in SelectItem; sentinel for "no shift". */
const NO_SHIFT = '__none__'

/** Who is who: role, the clock id that maps the NGTeco report to a user, shift and NSS. */
export function TeamTable() {
  const { data: profiles, isLoading } = useProfiles()
  const [editing, setEditing] = useState<ProfileWithAvatar | null>(null)
  const isDiscrete = useDiscreteModeStore((s) => s.isDiscreteMode)
  const fmt = useCurrency()

  if (isLoading || !profiles) {
    return (
      <Card><CardContent className="space-y-3 pt-6">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
      </CardContent></Card>
    )
  }

  return (
    <>
      <Card data-tour="team-table">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead>
                <TableHead>Rol</TableHead>
                <TableHead>Área</TableHead>
                <TableHead>Id checador</TableHead>
                <TableHead>Jornada</TableHead>
                <TableHead>NSS</TableHead>
                <TableHead className="text-right">Tarifa/h</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {profiles.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <span className="flex items-center gap-2 font-medium">
                      <UserAvatar id={p.id} name={p.display_name} url={p.avatar_url} />
                      {p.display_name}
                      {p.is_owner && (
                        <Crown className="size-4 text-amber-500" aria-label="Dueño del negocio" />
                      )}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Badge variant={p.role === 'admin' ? 'default' : 'secondary'}>{ROLE_LABELS[p.role]}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{AREA_LABELS[p.area]}</Badge>
                  </TableCell>
                  <TableCell className="tabular-nums text-muted-foreground">
                    {p.clock_employee_id ?? <span className="italic">no checa</span>}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {p.shift ? SHIFT_LABELS[p.shift] : <span className="italic">sin jornada</span>}
                  </TableCell>
                  <TableCell className="tabular-nums text-sm text-muted-foreground">
                    {p.nss ? (isDiscrete ? '•••••••••••' : maskNss(p.nss)) : <span className="italic">sin capturar</span>}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-sm text-muted-foreground">
                    {p.hourly_rate == null ? <span className="italic">sin tarifa</span> : fmt(p.hourly_rate)}
                  </TableCell>
                  <TableCell>
                    <Button variant="ghost" size="icon" className="size-8" onClick={() => setEditing(p)} aria-label={`Editar ${p.display_name}`}>
                      <Pencil className="size-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <ProfileDialog profile={editing} onClose={() => setEditing(null)} />
    </>
  )
}

function ProfileDialog({ profile, onClose }: { profile: ProfileWithAvatar | null; onClose: () => void }) {
  return (
    <Dialog open={!!profile} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="sm:max-w-md">
        {profile && <ProfileFields key={profile.id} profile={profile} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  )
}

function ProfileFields({ profile, onClose }: { profile: ProfileWithAvatar; onClose: () => void }) {
  const [name, setName] = useState(profile.display_name)
  const [role, setRole] = useState<ProfileRole>(profile.role)
  const [area, setArea] = useState<ProfileArea>(profile.area)
  const [clockId, setClockId] = useState(profile.clock_employee_id == null ? '' : String(profile.clock_employee_id))
  const [shift, setShift] = useState<ProfileShift | null>(profile.shift ?? null)
  const [nss, setNss] = useState(profile.nss ?? '')
  const [rate, setRate] = useState(profile.hourly_rate == null ? '' : String(profile.hourly_rate))
  const normalizedNss = normalizeNss(nss) || null
  const nssChanged = normalizedNss !== profile.nss
  const nssProblem = nssChanged && normalizedNss ? nssError(normalizedNss) : null
  const update = useUpdateProfile()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const parsed = clockId.trim() === '' ? null : Number(clockId)
    if (parsed !== null && (!Number.isInteger(parsed) || parsed < 1)) {
      toast.error('El id del checador debe ser un entero mayor a 0')
      return
    }
    if (nssProblem) {
      toast.error(nssProblem)
      return
    }
    // Rounded here too: what the admin sees after saving must be what they typed (numeric(10,2)).
    const parsedRate = rate.trim() === '' ? null : parseRate(rate)
    if (rate.trim() !== '' && parsedRate === null) {
      toast.error('La tarifa por hora debe ser un monto mayor a 0')
      return
    }
    try {
      await update.mutateAsync({
        id: profile.id,
        updates: {
          display_name: name.trim(), role, area, clock_employee_id: parsed, shift,
          ...(nssChanged ? { nss: normalizedNss } : {}),
          ...(parsedRate !== (profile.hourly_rate ?? null) ? { hourly_rate: parsedRate } : {}),
        },
      })
      toast.success('Perfil actualizado')
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo guardar')
    }
  }

  return (
    <>
        <DialogHeader>
          <DialogTitle>Editar perfil</DialogTitle>
          <DialogDescription>
            El id del checador es el número entre paréntesis en el reporte semanal.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="pf-name">Nombre</Label>
            <Input id="pf-name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pf-role">Rol</Label>
            <Select value={role} onValueChange={(v) => setRole(v as ProfileRole)}>
              <SelectTrigger id="pf-role"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(ROLE_LABELS) as ProfileRole[]).map((r) => (
                  <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="pf-area">Área</Label>
            <Select value={area} onValueChange={(v) => setArea(v as ProfileArea)}>
              <SelectTrigger id="pf-area"><SelectValue /></SelectTrigger>
              <SelectContent>
                {AREAS.map((a) => <SelectItem key={a} value={a}>{AREA_LABELS[a]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="pf-clock">Id checador</Label>
            <Input id="pf-clock" type="number" min={1} step={1} value={clockId} onChange={(e) => setClockId(e.target.value)} placeholder="Vacío = no checa" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pf-shift">Jornada</Label>
            <Select value={shift ?? NO_SHIFT} onValueChange={(v) => setShift(v === NO_SHIFT ? null : (v as ProfileShift))}>
              <SelectTrigger id="pf-shift"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_SHIFT}>Sin jornada</SelectItem>
                {SHIFTS.map((s) => (
                  <SelectItem key={s} value={s}>{SHIFT_LABELS[s]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Referencia de las gráficas de horas: 8 h o 4 h al día, 40 h o 20 h a la semana.</p>
          </div>
          <NssField id="pf-nss" label="NSS" saved={profile.nss} value={nss} onChange={setNss} error={nssProblem} />
          <div className="space-y-2">
            <Label htmlFor="pf-rate">Tarifa por hora</Label>
            <Input id="pf-rate" type="number" min={0.01} step={0.01} inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="Vacío = sin pago estimado" />
            <p className="text-xs text-muted-foreground">Calcula el pago estimado en Mi semana: todas las horas a esta tarifa más el sábado pagado.</p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={update.isPending}>Cancelar</Button>
            <Button type="submit" disabled={update.isPending}>{update.isPending ? 'Guardando…' : 'Guardar'}</Button>
          </DialogFooter>
        </form>
    </>
  )
}
