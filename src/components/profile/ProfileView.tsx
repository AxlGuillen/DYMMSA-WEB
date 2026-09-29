'use client'

import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Eye, EyeOff, Trash2, Upload } from '@/components/icons'
import { UserAvatar } from '@/components/profile/UserAvatar'
import { useProfile, useRemoveAvatar, useUpdateOwnProfile, useUploadAvatar } from '@/hooks/useProfile'
import { useDiscreteModeStore } from '@/stores/discreteModeStore'
import { cropAvatar } from '@/lib/image-compress'
import { maskNss, normalizeNss, nssError } from '@/lib/nss'
import { ROLE_LABELS } from '@/lib/profile'
import { SHIFT_LABELS } from '@/lib/timesheet'
import type { OwnProfile, OwnProfileUpdate } from '@/types/database'

const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp']

export function ProfileView() {
  const { profile, isLoading } = useProfile()

  if (isLoading || !profile) {
    return (
      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
      <PhotoCard profile={profile} />
      <div className="space-y-6">
        <DetailsForm key={`${profile.display_name}|${profile.nss}`} profile={profile} />
        <AccountCard profile={profile} />
      </div>
    </div>
  )
}

function PhotoCard({ profile }: { profile: OwnProfile }) {
  const input = useRef<HTMLInputElement>(null)
  const upload = useUploadAvatar()
  const remove = useRemoveAvatar()
  const busy = upload.isPending || remove.isPending

  const handleFile = async (file: File | undefined) => {
    if (!file) return
    if (!ACCEPTED.includes(file.type)) {
      toast.error('El archivo debe ser JPG, PNG o WebP')
      return
    }
    try {
      await upload.mutateAsync(await cropAvatar(file))
      toast.success('Foto actualizada')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo subir la foto')
    } finally {
      if (input.current) input.current.value = ''
    }
  }

  const handleRemove = async () => {
    try {
      await remove.mutateAsync()
      toast.success('Foto quitada')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo quitar la foto')
    }
  }

  return (
    <Card data-tour="profile-photo">
      <CardHeader>
        <CardTitle>Foto</CardTitle>
        <CardDescription>Se recorta en cuadro al centro. JPG, PNG o WebP.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col items-center gap-4">
        <UserAvatar id={profile.id} name={profile.display_name} url={profile.avatar_url} size="lg" labelled />
        <input
          ref={input}
          type="file"
          accept={ACCEPTED.join(',')}
          className="hidden"
          aria-label="Elegir foto"
          onChange={(e) => handleFile(e.target.files?.[0])}
        />
        <div className="flex flex-wrap justify-center gap-2">
          <Button size="sm" onClick={() => input.current?.click()} disabled={busy}>
            <Upload className="mr-2 size-4" />
            {upload.isPending ? 'Subiendo…' : profile.avatar_url ? 'Cambiar foto' : 'Subir foto'}
          </Button>
          {profile.avatar_url && (
            <Button size="sm" variant="outline" onClick={handleRemove} disabled={busy}>
              <Trash2 className="mr-2 size-4" />
              Quitar
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function DetailsForm({ profile }: { profile: OwnProfile }) {
  const [name, setName] = useState(profile.display_name)
  const [nss, setNss] = useState(profile.nss ?? '')
  const [revealed, setRevealed] = useState(false)
  const isDiscrete = useDiscreteModeStore((s) => s.isDiscreteMode)
  const update = useUpdateOwnProfile()

  const shown = revealed && !isDiscrete
  const normalized = normalizeNss(nss)
  const nssProblem = normalized ? nssError(normalized) : null
  const changes: OwnProfileUpdate = {}
  if (name.trim() !== profile.display_name) changes.display_name = name.trim()
  if ((normalized || null) !== profile.nss) changes.nss = normalized || null
  const dirty = Object.keys(changes).length > 0

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return toast.error('El nombre no puede quedar vacío')
    if (nssProblem) return toast.error(nssProblem)
    try {
      await update.mutateAsync(changes)
      toast.success('Perfil actualizado')
      setRevealed(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo guardar')
    }
  }

  return (
    <Card data-tour="profile-details">
      <CardHeader>
        <CardTitle>Tus datos</CardTitle>
        <CardDescription>Tu NSS solo lo ven tú y los administradores.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="me-name">Nombre</Label>
            <Input id="me-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="me-nss">Número de Seguridad Social (NSS)</Label>
            <div className="flex gap-2">
              <Input
                id="me-nss"
                inputMode="numeric"
                autoComplete="off"
                maxLength={14}
                placeholder="11 dígitos"
                value={shown || !profile.nss ? nss : maskNss(profile.nss)}
                readOnly={!shown && Boolean(profile.nss)}
                onChange={(e) => setNss(e.target.value)}
                aria-invalid={Boolean(nssProblem)}
              />
              {profile.nss && (
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => setRevealed((r) => !r)}
                  disabled={isDiscrete}
                  aria-label={shown ? 'Ocultar NSS' : 'Mostrar NSS'}
                  title={isDiscrete ? 'Modo discreto activo' : undefined}
                >
                  {shown ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </Button>
              )}
            </div>
            {nssProblem && <p className="text-xs text-destructive">{nssProblem}</p>}
          </div>
          <div className="flex justify-end">
            <Button type="submit" disabled={!dirty || update.isPending}>
              {update.isPending ? 'Guardando…' : 'Guardar'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

function AccountCard({ profile }: { profile: OwnProfile }) {
  const rows: [string, string][] = [
    ['Correo', profile.email ?? '—'],
    ['Rol', ROLE_LABELS[profile.role]],
    ['Jornada', profile.shift ? SHIFT_LABELS[profile.shift] : 'Sin jornada'],
    ['Id del checador', profile.clock_employee_id == null ? 'No checa' : String(profile.clock_employee_id)],
  ]
  return (
    <Card data-tour="profile-account">
      <CardHeader>
        <CardTitle>Tu cuenta</CardTitle>
        <CardDescription>Estos datos los cambia un administrador desde Equipo.</CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-3 sm:grid-cols-2">
          {rows.map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="text-sm font-medium">{value}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  )
}
