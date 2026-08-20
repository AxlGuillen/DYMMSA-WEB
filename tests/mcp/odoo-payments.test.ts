/**
 * Tools del bloque Odoo — Fase 6: complementos de pago REP (issue #70,
 * ADR-025). Formas reales de la instancia (2026-08-20): PAY00068 con 6
 * facturas conciliadas y su REP payment_sent/valid en l10n_mx_edi.document;
 * los l10n_mx_edi_* de account.payment computan false aunque haya REP.
 */

import { describe, test, expect } from 'vitest'
import type { OdooCaller } from '@/lib/odoo/client'
import { odooPaymentDetail, odooRepAudit } from '@/lib/mcp/tools/odoo/payments'
import { odooQuery } from '@/lib/mcp/tools/odoo/accounting'
import { ToolError } from '@/lib/mcp/shared'

type Call = { model: string; method: string; payload: Record<string, unknown> }

function fakeOdoo(script: Record<string, unknown[]>) {
  const calls: Call[] = []
  const pending = Object.fromEntries(Object.entries(script).map(([k, v]) => [k, [...v]]))
  const odoo: OdooCaller = async (model, method, payload) => {
    calls.push({ model, method, payload })
    const key = `${model}.${method}`
    const queue = pending[key]
    if (!queue || queue.length === 0) throw new Error(`sin respuesta programada para ${key}`)
    return queue.shift()
  }
  return { odoo, calls }
}

const PAY00068 = {
  id: 71,
  name: 'PAY00068',
  partner_id: [24, 'Andritz'],
  date: '2026-08-12',
  amount: 59868.07,
  payment_type: 'inbound',
  state: 'paid',
  memo: false,
  reconciled_invoice_ids: [436, 433],
}

const REP_DOC = {
  id: 549,
  move_id: [798, 'BNK1/2026/00346'],
  invoice_ids: [436, 433],
  state: 'payment_sent',
  sat_state: 'valid',
  attachment_uuid: 'abf7d8c3-49d5-4b55-af59-05147ee6a18c',
  datetime: '2026-08-13 16:51:17',
  message: false,
}

const F00275 = {
  id: 436,
  name: 'F00275',
  invoice_date: '2026-07-30',
  amount_total: 12176.52,
  amount_residual: 0,
  payment_state: 'paid',
  l10n_mx_edi_cfdi_uuid: '6063dc3f-b881-4ea9-a24b-d9bb40623340',
  l10n_mx_edi_cfdi_state: 'sent',
  l10n_mx_edi_cfdi_sat_state: 'valid',
}
const F00272 = { ...F00275, id: 433, name: 'F00272', amount_total: 1156.0 }

describe('catálogo fase 6', () => {
  test('l10n_mx_edi.document es consultable y filtrable (campos almacenados)', async () => {
    const { odoo, calls } = fakeOdoo({ 'l10n_mx_edi.document.search_read': [[REP_DOC]] })
    const result = await odooQuery(odoo, {
      model: 'l10n_mx_edi.document',
      domain: [['state', 'like', 'payment%'], ['sat_state', '=', 'valid']],
      limit: 5,
    })
    expect(result.count).toBe(1)
    expect(calls[0].payload.domain).toEqual([['state', 'like', 'payment%'], ['sat_state', '=', 'valid']])
  })

  test('reconciled_invoice_ids se puede LEER pidiéndolo explícito', async () => {
    const { odoo } = fakeOdoo({ 'account.payment.search_read': [[PAY00068]] })
    const result = await odooQuery(odoo, {
      model: 'account.payment',
      fields: ['name', 'reconciled_invoice_ids'],
      limit: 1,
    })
    expect(result.items[0].reconciled_invoice_ids).toEqual([436, 433])
  })

  test('candado: filtrar u ordenar por reconciled_invoice_ids se rechaza (Odoo daría 0 en silencio)', async () => {
    const { odoo } = fakeOdoo({})
    await expect(
      odooQuery(odoo, { model: 'account.payment', domain: [['reconciled_invoice_ids', 'in', [436]]] }),
    ).rejects.toThrow(/solo de lectura/)
    await expect(
      odooQuery(odoo, { model: 'account.payment', order: 'reconciled_invoice_ids asc' }),
    ).rejects.toThrow(/solo de lectura/)
  })

  test('la proyección por defecto NO incluye los readOnly (van solo bajo demanda)', async () => {
    const { odoo, calls } = fakeOdoo({ 'account.payment.search_read': [[]] })
    await odooQuery(odoo, { model: 'account.payment' })
    expect(calls[0].payload.fields).not.toContain('reconciled_invoice_ids')
  })

  test('los l10n_mx_edi_* del pago NO están en el catálogo (computan false, mentirían)', async () => {
    const { odoo } = fakeOdoo({})
    await expect(
      odooQuery(odoo, { model: 'account.payment', fields: ['l10n_mx_edi_cfdi_state'] }),
    ).rejects.toThrow(/no está en el catálogo/)
  })
})

describe('odoo_payment_detail', () => {
  test('pago con REP timbrado: cruce completo en 3 llamadas', async () => {
    const { odoo, calls } = fakeOdoo({
      'account.payment.search_read': [[PAY00068]],
      'l10n_mx_edi.document.search_read': [[REP_DOC]],
      'account.move.search_read': [[F00275, F00272]],
    })

    const result = await odooPaymentDetail(odoo, { folio: 'pay00068' })

    expect(calls).toHaveLength(3)
    // El puente pago↔REP: documentos payment% que tocan SUS facturas.
    expect(calls[1].payload.domain).toEqual([['invoice_ids', 'in', [436, 433]], ['state', 'like', 'payment%']])
    expect(calls[2].payload.domain).toEqual([['id', 'in', [436, 433]]])

    expect(result.encontrado).toBe(true)
    if (result.encontrado) {
      expect(result.pago).toMatchObject({ folio: 'PAY00068', cliente: 'Andritz', monto: 59868.07, tipo: 'cobro', estado: 'pagado' })
      expect(result.complemento_pago).toEqual([
        {
          estado: 'timbrado',
          estado_sat: 'vigente ante el SAT',
          folio_fiscal: REP_DOC.attachment_uuid,
          fecha: REP_DOC.datetime,
          asiento: 'BNK1/2026/00346',
          facturas_que_cubre: ['F00275', 'F00272'],
          detalle: undefined,
        },
      ])
      expect(result.facturas_que_paga[0]).toMatchObject({
        folio: 'F00275',
        saldo_pendiente: 0,
        estado_pago: 'paid',
        timbrado: { timbrada: true, estado_sat: 'vigente ante el SAT' },
      })
    }
  })

  test('pago con facturas pero SIN REP → aviso explícito (el caso que motivó la issue)', async () => {
    const { odoo } = fakeOdoo({
      'account.payment.search_read': [[PAY00068]],
      'l10n_mx_edi.document.search_read': [[]],
      'account.move.search_read': [[F00275, F00272]],
    })
    const result = await odooPaymentDetail(odoo, { folio: 'PAY00068' })
    if (result.encontrado) {
      expect(result.complemento_pago).toEqual({
        timbrado: false,
        detalle: 'Sin REP: ningún complemento de pago cubre las facturas de este pago.',
      })
    }
  })

  test('pago sin facturas conciliadas → 1 sola llamada, sin buscar REP', async () => {
    const { odoo, calls } = fakeOdoo({
      'account.payment.search_read': [[{ ...PAY00068, reconciled_invoice_ids: [] }]],
    })
    const result = await odooPaymentDetail(odoo, { folio: 'PAY00068' })
    expect(calls).toHaveLength(1)
    if (result.encontrado) {
      expect(result.complemento_pago).toMatchObject({ timbrado: false })
      expect(result.facturas_que_paga).toEqual([])
    }
  })

  test('folio parcial con varias coincidencias → lista para precisar', async () => {
    const { odoo, calls } = fakeOdoo({
      'account.payment.search_read': [[
        { ...PAY00068, id: 1, name: 'PAY00010' },
        { ...PAY00068, id: 2, name: 'PAY00011' },
      ]],
    })
    const result = await odooPaymentDetail(odoo, { folio: 'PAY000' })
    expect(result.encontrado).toBe(false)
    if (!result.encontrado) expect(result.coincidencias).toEqual(['PAY00010', 'PAY00011'])
    expect(calls).toHaveLength(1)
  })
})

describe('odoo_rep_audit', () => {
  const pago = (over: Record<string, unknown>) => ({ ...PAY00068, ...over })

  test('clasifica: en regla / sin REP / REP con problema', async () => {
    const { odoo, calls } = fakeOdoo({
      'account.payment.search_read': [[
        pago({ id: 1, name: 'PAY00061', reconciled_invoice_ids: [436, 433] }),
        pago({ id: 2, name: 'PAY00062', reconciled_invoice_ids: [500] }),
        pago({ id: 3, name: 'PAY00063', reconciled_invoice_ids: [600] }),
        pago({ id: 4, name: 'PAY00064', reconciled_invoice_ids: [] }),
      ]],
      'l10n_mx_edi.document.search_read': [[
        REP_DOC,
        { ...REP_DOC, id: 550, invoice_ids: [600], state: 'payment_sent_failed', sat_state: 'not_defined', datetime: '2026-08-14 10:00:00' },
      ]],
      // 3ª llamada (solo hay porque quedó un pago sin REP): política PUE/PPD.
      'account.move.search_read': [[{ id: 500, l10n_mx_edi_payment_policy: 'PPD' }]],
    })

    const result = await odooRepAudit(odoo, { date_from: '2026-08-01', date_to: '2026-08-31' })

    expect(calls).toHaveLength(3)
    expect(calls[2].payload.domain).toEqual([['id', 'in', [500]]])
    expect(calls[0].payload.domain).toEqual([
      ['payment_type', '=', 'inbound'],
      ['state', 'in', ['in_process', 'paid']],
      ['date', '>=', '2026-08-01'],
      ['date', '<=', '2026-08-31'],
    ])
    // Los docs se buscan por la unión de facturas SIN filtro de fecha:
    // el REP puede timbrarse días después del pago.
    expect(calls[1].payload.domain).toEqual([
      ['invoice_ids', 'in', [436, 433, 500, 600]],
      ['state', 'like', 'payment%'],
    ])

    expect(result.pagos_revisados).toBe(4)
    expect(result.en_regla).toBe(1)
    expect(result.sin_rep).toEqual([
      { folio: 'PAY00062', cliente: 'Andritz', fecha: '2026-08-12', monto: 59868.07 },
    ])
    expect(result.rep_con_problema).toEqual([
      {
        folio: 'PAY00063', cliente: 'Andritz', fecha: '2026-08-12', monto: 59868.07,
        estado_rep: 'falló el timbrado', estado_sat: 'sin verificar con el SAT', fecha_rep: '2026-08-14 10:00:00',
      },
    ])
    expect(result.sin_facturas_conciliadas).toEqual([
      { folio: 'PAY00064', cliente: 'Andritz', fecha: '2026-08-12', monto: 59868.07 },
    ])
  })

  test('un REP cubre al pago solo si abarca TODAS sus facturas', async () => {
    const { odoo } = fakeOdoo({
      'account.payment.search_read': [[pago({ reconciled_invoice_ids: [436, 700] })]],
      // El doc solo cubre la 436 — la 700 quedó fuera: el pago NO está en regla.
      'l10n_mx_edi.document.search_read': [[REP_DOC]],
      'account.move.search_read': [[
        { id: 436, l10n_mx_edi_payment_policy: 'PPD' },
        { id: 700, l10n_mx_edi_payment_policy: 'PPD' },
      ]],
    })
    const result = await odooRepAudit(odoo, { date_from: '2026-08-01' })
    expect(result.en_regla).toBe(0)
    expect(result.sin_rep).toHaveLength(1)
  })

  test('pago 100% PUE sin doc REP → no_requiere_rep, no falso positivo (review PR #75)', async () => {
    const { odoo, calls } = fakeOdoo({
      'account.payment.search_read': [[
        pago({ id: 1, name: 'PAY00070', reconciled_invoice_ids: [800] }),
        pago({ id: 2, name: 'PAY00071', reconciled_invoice_ids: [801, 802] }),
      ]],
      'l10n_mx_edi.document.search_read': [[]],
      'account.move.search_read': [[
        { id: 800, l10n_mx_edi_payment_policy: 'PUE' },
        { id: 801, l10n_mx_edi_payment_policy: 'PUE' },
        // Mixto PUE+PPD: la PPD sí exige REP → el pago sigue pendiente.
        { id: 802, l10n_mx_edi_payment_policy: 'PPD' },
      ]],
    })
    const result = await odooRepAudit(odoo, {})
    expect(calls).toHaveLength(3)
    expect(result.no_requiere_rep).toBe(1)
    expect(result.sin_rep).toEqual([
      { folio: 'PAY00071', cliente: 'Andritz', fecha: '2026-08-12', monto: 59868.07 },
    ])
  })

  test('con REP re-timbrado manda el más reciente (el fallido viejo no cuenta)', async () => {
    const { odoo } = fakeOdoo({
      'account.payment.search_read': [[pago({})]],
      'l10n_mx_edi.document.search_read': [[
        { ...REP_DOC, id: 540, state: 'payment_sent_failed', sat_state: 'not_defined', datetime: '2026-08-12 09:00:00' },
        REP_DOC, // payment_sent/valid, 2026-08-13
      ]],
    })
    const result = await odooRepAudit(odoo, {})
    expect(result.en_regla).toBe(1)
    expect(result.rep_con_problema).toEqual([])
  })

  test('payment_sent_pue (no requiere REP) cuenta como en regla aunque el SAT diga skip', async () => {
    const { odoo } = fakeOdoo({
      'account.payment.search_read': [[pago({})]],
      'l10n_mx_edi.document.search_read': [[{ ...REP_DOC, state: 'payment_sent_pue', sat_state: 'skip' }]],
    })
    const result = await odooRepAudit(odoo, {})
    expect(result.en_regla).toBe(1)
  })

  test('sin pagos en el rango: no busca documentos (1 llamada) y regresa vacío', async () => {
    const { odoo, calls } = fakeOdoo({ 'account.payment.search_read': [[]] })
    const result = await odooRepAudit(odoo, {})
    expect(calls).toHaveLength(1)
    expect(result.pagos_revisados).toBe(0)
    expect(result.en_regla).toBe(0)
  })

  test('fecha inválida → ToolError accionable', async () => {
    const { odoo } = fakeOdoo({})
    await expect(odooRepAudit(odoo, { date_from: '12/08/2026' })).rejects.toThrow(ToolError)
  })
})
