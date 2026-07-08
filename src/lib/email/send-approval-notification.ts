import { getResend } from './client'

/**
 * Notificación por correo a DYMMSA cuando el cliente FINALIZA una cotización
 * con al menos un ítem aprobado (status → 'approved').
 *
 * Diseño (ver ADR-012):
 * - Nunca lanza: devuelve { ok } para que el flujo de aprobación jamás falle
 *   por un problema de correo (mismo principio que auto-learn / ADR-009).
 * - Sin config (RESEND_API_KEY / RESEND_FROM_EMAIL / NOTIFICATION_EMAIL_TO) →
 *   { ok: false, skipped: true }: se omite en silencio, no es error.
 */

/**
 * Interruptor temporal: notificaciones por correo DESHABILITADAS hasta configurar
 * Resend en producción (dominio verificado + env vars, y decidir destinatarios).
 * Para reactivar: poner en `true` (y tener las env vars configuradas en Vercel).
 */
const EMAIL_NOTIFICATIONS_ENABLED: boolean = false

interface ApprovalNotificationInput {
  customerName: string
  quotationName: string
  total: number
  approvedCount: number
  quotationId: string
}

interface SendResult {
  ok: boolean
  skipped?: boolean
  error?: string
}

function formatMXN(amount: number): string {
  return amount.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })
}

/**
 * Construye el link absoluto a la cotización, o `null` si `NEXT_PUBLIC_APP_URL`
 * falta o no es absoluta (evita meter un href relativo — roto en un cliente de
 * correo). Con `null`, el email se envía igual pero sin botón.
 */
export function buildQuotationUrl(appUrl: string | undefined, quotationId: string): string | null {
  if (!appUrl) return null
  const base = appUrl.trim().replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(base)) return null
  return `${base}/dashboard/quotations/${quotationId}`
}

export function buildHtml(input: ApprovalNotificationInput, quotationUrl: string | null): string {
  const { customerName, quotationName, total, approvedCount } = input
  const button = quotationUrl
    ? `<a href="${quotationUrl}" style="display: inline-block; background: #1a1a1a; color: #fff; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-weight: 600;">Ver cotización</a>`
    : ''
  return `
    <div style="font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; max-width: 560px; margin: 0 auto; color: #1a1a1a;">
      <h2 style="margin: 0 0 4px;">Cotización aprobada por el cliente</h2>
      <p style="margin: 0 0 20px; color: #666;">El cliente finalizó su revisión. Ya puedes continuar el proceso.</p>
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
        <tr><td style="padding: 6px 0; color: #666;">Cliente</td><td style="padding: 6px 0; text-align: right; font-weight: 600;">${customerName}</td></tr>
        <tr><td style="padding: 6px 0; color: #666;">Cotización</td><td style="padding: 6px 0; text-align: right; font-weight: 600;">${quotationName}</td></tr>
        <tr><td style="padding: 6px 0; color: #666;">Ítems aprobados</td><td style="padding: 6px 0; text-align: right; font-weight: 600;">${approvedCount}</td></tr>
        <tr><td style="padding: 6px 0; color: #666;">Total aprobado</td><td style="padding: 6px 0; text-align: right; font-weight: 600;">${formatMXN(total)}</td></tr>
      </table>
      ${button}
      <p style="margin: 24px 0 0; font-size: 12px; color: #999;">DYMMSA · Sistema de cotizaciones</p>
    </div>
  `
}

export async function sendApprovalNotification(
  input: ApprovalNotificationInput,
): Promise<SendResult> {
  if (!EMAIL_NOTIFICATIONS_ENABLED) {
    return { ok: false, skipped: true }
  }

  const resend = getResend()
  const from = process.env.RESEND_FROM_EMAIL
  const to = process.env.NOTIFICATION_EMAIL_TO

  if (!resend || !from || !to) {
    return { ok: false, skipped: true }
  }

  const quotationUrl = buildQuotationUrl(process.env.NEXT_PUBLIC_APP_URL, input.quotationId)
  if (!quotationUrl) {
    console.warn('sendApprovalNotification: NEXT_PUBLIC_APP_URL ausente o no absoluta → email sin botón de enlace')
  }

  try {
    const { error } = await resend.emails.send({
      from,
      to,
      replyTo: process.env.NOTIFICATION_REPLY_TO || undefined,
      subject: `Cotización aprobada — ${input.customerName}`,
      html: buildHtml(input, quotationUrl),
    })

    if (error) {
      console.warn('sendApprovalNotification: Resend error', error)
      return { ok: false, error: error.message }
    }
    return { ok: true }
  } catch (err) {
    console.warn('sendApprovalNotification: threw', err)
    return { ok: false, error: err instanceof Error ? err.message : 'unknown' }
  }
}
