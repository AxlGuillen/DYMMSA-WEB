/**
 * Módulo de email — funciones puras de armado del correo de aprobación.
 * El envío real (Resend) se cubre indirectamente en tests/api/approve.test.ts.
 */

import { describe, test, expect } from 'vitest'
import { buildQuotationUrl, buildHtml } from '@/lib/email/send-approval-notification'

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
    // pero el resto del correo (datos) sigue presente
    expect(html).toContain('ACME')
    expect(html).toContain('COT-001')
  })
})
