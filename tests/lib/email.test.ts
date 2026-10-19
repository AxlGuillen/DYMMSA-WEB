/** Approval mail: pure builders plus the kill switch; the route side is in tests/api/approve.test.ts. */

import { describe, test, expect, vi, afterEach } from 'vitest'

const send = vi.fn()
vi.mock('@/lib/email/client', () => ({ getResend: () => ({ emails: { send } }) }))

import {
  buildQuotationUrl,
  buildHtml,
  sendApprovalNotification,
} from '@/lib/email/send-approval-notification'

describe('buildQuotationUrl', () => {
  test('arma URL absoluta cuando NEXT_PUBLIC_APP_URL es válida', () => {
    expect(buildQuotationUrl('https://app.dymmsa.com', 'q1')).toBe(
      'https://app.dymmsa.com/dashboard/quotations/q1',
    )
  })

  test('recorta el slash final antes de concatenar', () => {
    expect(buildQuotationUrl('https://app.dymmsa.com/', 'q1')).toBe(
      'https://app.dymmsa.com/dashboard/quotations/q1',
    )
  })

  test('devuelve null si la env está ausente o vacía', () => {
    expect(buildQuotationUrl(undefined, 'q1')).toBeNull()
    expect(buildQuotationUrl('', 'q1')).toBeNull()
    expect(buildQuotationUrl('   ', 'q1')).toBeNull()
  })

  test('devuelve null si no es absoluta (evita href relativo roto en el correo)', () => {
    expect(buildQuotationUrl('/dashboard', 'q1')).toBeNull()
    expect(buildQuotationUrl('app.dymmsa.com', 'q1')).toBeNull()
  })
})

describe('buildHtml', () => {
  const input = { customerName: 'ACME', quotationName: 'COT-001', total: 1500, approvedCount: 2, quotationId: 'q1' }

  test('incluye el botón "Ver cotización" cuando hay URL', () => {
    const html = buildHtml(input, 'https://app.dymmsa.com/dashboard/quotations/q1')
    expect(html).toContain('href="https://app.dymmsa.com/dashboard/quotations/q1"')
    expect(html).toContain('Ver cotización')
  })

  test('omite el botón (sin href) cuando la URL es null', () => {
    const html = buildHtml(input, null)
    expect(html).not.toContain('<a href')
    // but the rest of the mail (the data) is still there
    expect(html).toContain('ACME')
    expect(html).toContain('COT-001')
  })
})

describe('sendApprovalNotification', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    send.mockReset()
  })

  // Turning the switch on must come with tours/docs that promise the email again (ADR-012, #25).
  test('el interruptor sigue apagado: no manda nada aunque Resend esté configurado', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_test')
    vi.stubEnv('RESEND_FROM_EMAIL', 'avisos@dymmsa.test')
    vi.stubEnv('NOTIFICATION_EMAIL_TO', 'ventas@dymmsa.test')
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.dymmsa.test')

    const result = await sendApprovalNotification({
      customerName: 'ACME', quotationName: 'COT-001', total: 1500, approvedCount: 2, quotationId: 'q1',
    })

    expect(result).toEqual({ ok: false, skipped: true })
    expect(send).not.toHaveBeenCalled()
  })
})
