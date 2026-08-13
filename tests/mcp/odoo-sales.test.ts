/**
 * Tools del bloque Odoo — Fase 2: Contactos + Ventas (issue #65, ADR-025).
 * Formas reales de la instancia (2026-08-11): res.partner sin `mobile`
 * (Odoo 19), date_order como DATETIME, false para email/phone vacíos.
 */

import { describe, test, expect } from 'vitest'
import type { OdooCaller } from '@/lib/odoo/client'
import { odooSalesSummary, odooCustomerProfile } from '@/lib/mcp/tools/odoo/sales'
import { odooQuery } from '@/lib/mcp/tools/odoo/accounting'

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

const ANDRITZ = {
  id: 24,
  name: 'Andritz',
  email: 'contact-hydro.mx@andritz.com',
  phone: '+52 443 323 1530',
  vat: 'AHY9601017X4',
  city: 'Morelia',
  country_id: [156, 'Mexico'],
  customer_rank: 116,
}

describe('catálogo fase 2', () => {
  test('res.partner y sale.order ya son consultables vía odoo_query', async () => {
    const { odoo } = fakeOdoo({ 'res.partner.search_read': [[ANDRITZ]] })
    const result = await odooQuery(odoo, { model: 'res.partner', limit: 1 })
    expect(result.items[0].country_id).toBe('Mexico')
  })

  test('mobile NO está en la whitelist (no existe en Odoo 19)', async () => {
    const { odoo } = fakeOdoo({})
    await expect(odooQuery(odoo, { model: 'res.partner', fields: ['mobile'] })).rejects.toThrow(/mobile/)
  })
})

describe('odoo_sales_summary', () => {
  test('default: solo confirmadas, con el rango datetime expandido al día completo', async () => {
    const { odoo, calls } = fakeOdoo({
      'sale.order.read_group': [[
        { state: 'sale', state_count: 383, amount_untaxed: 6800000, amount_total: 7863084.2, __domain: [] },
        { state: 'done', state_count: 10, amount_untaxed: 90000, amount_total: 104400, __domain: [] },
      ]],
    })
    const result = await odooSalesSummary(odoo, { date_from: '2026-07-01', date_to: '2026-07-31' })

    const domain = calls[0].payload.domain as unknown[][]
    expect(domain).toContainEqual(['state', 'in', ['sale', 'done']])
    expect(domain).toContainEqual(['date_order', '>=', '2026-07-01 00:00:00'])
    expect(domain).toContainEqual(['date_order', '<=', '2026-07-31 23:59:59'])
    expect(result.total_ventas).toBeCloseTo(7967484.2)
    expect(result.ordenes).toBe(393)
  })

  test('incluir=todas cambia el filtro a "todo menos canceladas" y agrupa por vendedor', async () => {
    const { odoo, calls } = fakeOdoo({
      'sale.order.read_group': [[
        { user_id: [2, 'Diego Baltazar Esquivel'], user_id_count: 500, amount_total: 17000000, __domain: [] },
      ]],
    })
    await odooSalesSummary(odoo, { incluir: 'todas', group_by: 'vendedor' })
    expect(calls[0].payload.domain).toContainEqual(['state', '!=', 'cancel'])
    expect(calls[0].payload.groupby).toEqual(['user_id'])
  })
})

describe('odoo_customer_profile', () => {
  test('varias coincidencias → pide precisar con la lista, sin llamadas extra', async () => {
    const { odoo, calls } = fakeOdoo({
      'res.partner.search_read': [[ANDRITZ, { ...ANDRITZ, id: 99, name: 'Andritz Hydro' }]],
    })
    const result = await odooCustomerProfile(odoo, { cliente: 'andritz' })
    expect(result.encontrado).toBe(false)
    if (!result.encontrado) expect(result.coincidencias).toEqual(['Andritz', 'Andritz Hydro'])
    expect(calls).toHaveLength(1)
  })

  test('match único → expediente completo en 4 llamadas (contacto+ventas+facturación+vencidas)', async () => {
    const { odoo, calls } = fakeOdoo({
      'res.partner.search_read': [[ANDRITZ]],
      'sale.order.read_group': [[
        { state: 'sale', state_count: 80, amount_total: 900000, __domain: [] },
        { state: 'draft', state_count: 5, amount_total: 50000, __domain: [] },
      ]],
      'account.move.read_group': [[
        { payment_state: 'paid', payment_state_count: 60, amount_total: 700000, amount_residual: 0, __domain: [] },
        { payment_state: 'not_paid', payment_state_count: 5, amount_total: 20253.47, amount_residual: 20253.47, __domain: [] },
      ]],
      'account.move.search_read': [[
        { id: 1, name: 'F00078', invoice_date_due: '2026-06-05', amount_residual: 6558.64 },
      ]],
    })

    const result = await odooCustomerProfile(odoo, { cliente: 'Andritz' })

    expect(calls).toHaveLength(4)
    // Las 3 llamadas de detalle filtran por el id del partner encontrado.
    for (const call of calls.slice(1)) {
      expect(call.payload.domain).toContainEqual(['partner_id', '=', 24])
    }
    expect(result.encontrado).toBe(true)
    if (result.encontrado) {
      expect(result.cliente.vat).toBe('AHY9601017X4')
      // Solo confirmadas (sale/done): las draft de Odoo son cotizaciones, no ventas.
      expect(result.ventas.total_confirmado).toBe(900000)
      expect(result.facturacion.total_pendiente).toBeCloseTo(20253.47)
      expect(result.facturas_vencidas[0]).toMatchObject({ folio: 'F00078', monto_pendiente: 6558.64 })
      expect(result.facturas_vencidas[0].dias_vencida).toBeGreaterThan(0)
    }
  })

  test('sin coincidencias → mensaje claro', async () => {
    const { odoo } = fakeOdoo({ 'res.partner.search_read': [[]] })
    const result = await odooCustomerProfile(odoo, { cliente: 'Empresa Fantasma' })
    expect(result.encontrado).toBe(false)
    if (!result.encontrado) expect(result.mensaje).toContain('Empresa Fantasma')
  })
})
