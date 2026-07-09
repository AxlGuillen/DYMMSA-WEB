import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAuth, badRequest, serverError } from '@/lib/api-helpers'

const BUCKET = 'task-images'
const MAX_BYTES = 5 * 1024 * 1024 // 5 MB (igual que el límite del bucket)
const ALLOWED = new Map<string, string>([
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/gif', 'gif'],
  ['image/webp', 'webp'],
])

// ------------------------------------------------------------------ //
// POST /api/tasks/upload  (multipart: file)                          //
// Sube una imagen al bucket público y devuelve { url } para embeberla //
// en el markdown del issue. Subida con service role (bypassa RLS).    //
// ------------------------------------------------------------------ //
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const auth = await requireAuth(supabase)
    if ('error' in auth) return auth.error

    const formData = await request.formData()
    const file = formData.get('file')
    if (!(file instanceof File)) return badRequest('No se proporcionó imagen')

    const ext = ALLOWED.get(file.type)
    if (!ext) return badRequest('Formato no permitido (usa PNG, JPG, GIF o WEBP)')
    if (file.size > MAX_BYTES) return badRequest('La imagen supera el límite de 5 MB')

    const path = `${crypto.randomUUID()}.${ext}`
    const admin = createAdminClient()
    const { error } = await admin.storage
      .from(BUCKET)
      .upload(path, file, { contentType: file.type, upsert: false })

    if (error) {
      console.error('Task image upload error:', error)
      return serverError('Error al subir la imagen')
    }

    const { data } = admin.storage.from(BUCKET).getPublicUrl(path)
    return NextResponse.json({ url: data.publicUrl }, { status: 201 })
  } catch (e) {
    console.error('Task upload route error:', e)
    return serverError()
  }
}
