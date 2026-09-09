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
import { Pencil } from '@/components/icons'
import { useProfiles, useUpdateProfile } from '@/hooks/useProfile'
import type { Profile, ProfileRole } from '@/types/database'

const ROLE_LABELS: Record<ProfileRole, string> = { admin: 'Administrador', member: 'Miembro' }

/** Who is who: role and the clock id that maps the NGTeco report to a user. */
export function TeamTable() {
  const { data: profiles, isLoading } = useProfiles()
  const [editing, setEditing] = useState<Profile | null>(null)

  if (isLoading || !profiles) {
    return (
      <Card><CardContent className="space-y-3 pt-6">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
      </CardContent></Card>
    )
  }

  return (
    <>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead>
                <TableHead>Rol</TableHead>
                <TableHead>Id checador</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {profiles.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">{p.display_name}</TableCell>
                  <TableCell>
                    <Badge variant={p.role === 'admin' ? 'default' : 'secondary'}>{ROLE_LABELS[p.role]}</Badge>
                  </TableCell>
                  <TableCell className="tabular-nums text-muted-foreground">
                    {p.clock_employee_id ?? <span className="italic">no checa</span>}
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

function ProfileDialog({ profile, onClose }: { profile: Profile | null; onClose: () => void }) {
  return (
    <Dialog open={!!profile} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="sm:max-w-md">
        {profile && <ProfileFields key={profile.id} profile={profile} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  )
}

function ProfileFields({ profile, onClose }: { profile: Profile; onClose: () => void }) {
  const [name, setName] = useState(profile.display_name)
  const [role, setRole] = useState<ProfileRole>(profile.role)
  const [clockId, setClockId] = useState(profile.clock_employee_id == null ? '' : String(profile.clock_employee_id))
  const update = useUpdateProfile()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const parsed = clockId.trim() === '' ? null : Number(clockId)
    if (parsed !== null && (!Number.isInteger(parsed) || parsed < 1)) {
      toast.error('El id del checador debe ser un entero mayor a 0')
      return
    }
    try {
      await update.mutateAsync({
        id: profile.id,
        updates: { display_name: name.trim(), role, clock_employee_id: parsed },
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
            <Label htmlFor="pf-clock">Id checador</Label>
            <Input id="pf-clock" type="number" min={1} step={1} value={clockId} onChange={(e) => setClockId(e.target.value)} placeholder="Vacío = no checa" />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={update.isPending}>Cancelar</Button>
            <Button type="submit" disabled={update.isPending}>{update.isPending ? 'Guardando…' : 'Guardar'}</Button>
          </DialogFooter>
        </form>
    </>
  )
}
