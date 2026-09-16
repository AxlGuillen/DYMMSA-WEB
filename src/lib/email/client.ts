import { Resend } from 'resend'

/** Lazy Resend client: no RESEND_API_KEY means "don't send", not an error. */
let cached: Resend | null = null

export function getResend(): Resend | null {
  const key = process.env.RESEND_API_KEY
  if (!key) return null
  if (!cached) cached = new Resend(key)
  return cached
}
