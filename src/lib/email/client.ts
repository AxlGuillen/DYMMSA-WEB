import { Resend } from 'resend'

/** Cliente Resend lazy: sin RESEND_API_KEY devuelve null — falta de config = no se envía, no error. */
let cached: Resend | null = null

export function getResend(): Resend | null {
  const key = process.env.RESEND_API_KEY
  if (!key) return null
  if (!cached) cached = new Resend(key)
  return cached
}
