import { Resend } from 'resend'

/**
 * Cliente Resend perezoso (lazy).
 *
 * No se instancia en import-time para no romper el build ni los tests cuando
 * falta RESEND_API_KEY. Devuelve `null` si no hay key configurada → el caller
 * trata la falta de config como "no se envía", no como error.
 */
let cached: Resend | null = null

export function getResend(): Resend | null {
  const key = process.env.RESEND_API_KEY
  if (!key) return null
  if (!cached) cached = new Resend(key)
  return cached
}
