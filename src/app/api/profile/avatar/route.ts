import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAuth, badRequest, notFound, serverError } from '@/lib/api-helpers'
import { AVATAR_BUCKET, AVATAR_MAX_BYTES, AVATAR_MAX_PX, avatarPublicUrl } from '@/lib/avatar'
import { readImageInfo } from '@/lib/image-info'

type Supabase = Awaited<ReturnType<typeof createClient>>

const EXTENSION = { jpeg: 'jpg', png: 'png', webp: 'webp' } as const

async function currentAvatarPath(supabase: Supabase, userId: string) {
  const { data, error } = await supabase.from('profiles').select('avatar_path').eq('id', userId).single()
  if (error || !data) return { error }
  return { path: (data as { avatar_path: string | null }).avatar_path }
}

async function removeQuietly(supabase: Supabase, path: string | null) {
  if (!path) return
  const { error } = await supabase.storage.from(AVATAR_BUCKET).remove([path])
  if (error) console.warn('Old avatar not removed:', error)
}

// POST /api/profile/avatar — the caller's picture; validated by its bytes, uploaded with their own token (#122)
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const auth = await requireAuth(supabase)
    if ('error' in auth) return auth.error

    const file = (await request.formData()).get('file')
    if (!(file instanceof File)) return badRequest('No se recibió la imagen')
    if (file.size > AVATAR_MAX_BYTES) return badRequest('La imagen pesa más de 2 MB')

    const bytes = new Uint8Array(await file.arrayBuffer())
    const info = readImageInfo(bytes)
    if (!info) return badRequest('El archivo debe ser JPG, PNG o WebP')
    if (info.width > AVATAR_MAX_PX || info.height > AVATAR_MAX_PX) {
      return badRequest(`La imagen debe medir como máximo ${AVATAR_MAX_PX} × ${AVATAR_MAX_PX} px`)
    }

    const current = await currentAvatarPath(supabase, auth.user.id)
    if ('error' in current) {
      if (current.error?.code === 'PGRST116') return notFound('Tu perfil no existe')
      console.error('Error reading avatar path:', current.error)
      return serverError('Error al subir la foto')
    }

    const path = `${auth.user.id}/${crypto.randomUUID()}.${EXTENSION[info.kind]}`
    const upload = await supabase.storage
      .from(AVATAR_BUCKET)
      .upload(path, bytes, { contentType: info.mime, upsert: false })
    if (upload.error) {
      console.error('Avatar upload error:', upload.error)
      return serverError('Error al subir la foto')
    }

    const { error } = await supabase.from('profiles').update({ avatar_path: path }).eq('id', auth.user.id)
    if (error) {
      console.error('Error saving avatar path:', error)
      await removeQuietly(supabase, path)
      return serverError('Error al guardar la foto')
    }

    await removeQuietly(supabase, current.path)
    return NextResponse.json({ avatar_url: avatarPublicUrl(path) }, { status: 201 })
  } catch (error) {
    console.error('Avatar POST error:', error)
    return serverError('Error al subir la foto')
  }
}

// DELETE /api/profile/avatar — back to the initials
export async function DELETE() {
  try {
    const supabase = await createClient()
    const auth = await requireAuth(supabase)
    if ('error' in auth) return auth.error

    const current = await currentAvatarPath(supabase, auth.user.id)
    if ('error' in current) {
      if (current.error?.code === 'PGRST116') return notFound('Tu perfil no existe')
      console.error('Error reading avatar path:', current.error)
      return serverError('Error al quitar la foto')
    }
    if (!current.path) return NextResponse.json({ avatar_url: null })

    const { error } = await supabase.from('profiles').update({ avatar_path: null }).eq('id', auth.user.id)
    if (error) {
      console.error('Error clearing avatar path:', error)
      return serverError('Error al quitar la foto')
    }

    await removeQuietly(supabase, current.path)
    return NextResponse.json({ avatar_url: null })
  } catch (error) {
    console.error('Avatar DELETE error:', error)
    return serverError('Error al quitar la foto')
  }
}
