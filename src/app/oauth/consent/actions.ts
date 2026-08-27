'use server'

/** Consentimiento OAuth (ADR-023): Supabase valida el authorization_id contra la sesión — el campo oculto no necesita ser de fiar. */

import { redirect } from 'next/navigation'

import { createClient } from '@/lib/supabase/server'

async function decide(formData: FormData, action: 'approve' | 'deny'): Promise<string> {
  const authorizationId = String(formData.get('authorization_id') ?? '')
  if (!authorizationId) throw new Error('Falta el identificador de autorización.')

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data, error } =
    action === 'approve'
      ? await supabase.auth.oauth.approveAuthorization(authorizationId)
      : await supabase.auth.oauth.denyAuthorization(authorizationId)

  if (error || !data?.redirect_url) {
    throw new Error(error?.message ?? 'No se pudo resolver la autorización.')
  }
  return data.redirect_url
}

// `redirect()` lanza NEXT_REDIRECT, así que va FUERA de cualquier try/catch.
export async function approveAction(formData: FormData): Promise<void> {
  redirect(await decide(formData, 'approve'))
}

export async function denyAction(formData: FormData): Promise<void> {
  redirect(await decide(formData, 'deny'))
}
