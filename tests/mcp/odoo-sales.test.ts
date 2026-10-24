/** Odoo block, phase 2: contacts + sales (#65, ADR-025). Real shapes: res.partner
 *  without `mobile` (Odoo 19), date_order as DATETIME, false for empty email/phone. */

import { describe, test, expect } from 'vitest'
import { odooSummarizeSales } from '@/lib/mcp/tools/odoo/sales'
import { odooSearchRecords } from '@/lib/mcp/tools/odoo/accounting'
import { fakeOdoo } from '../helpers/fake-odoo'

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
  test('res.partner y sale.order ya son consultables vía odoo_search_records', async () => {
    const { odoo } = fakeOdoo({ 'res.partner.search_read': [[ANDRITZ]] })
    const result = await odooSearchRecords(odoo, { modelo: 'res.partner', limite: 1 })
    expect(result.items[0].country_id).toBe('Mexico')
  })

  test('mobile NO está en la whitelist (no existe en Odoo 19)', async () => {
    const { odoo } = fakeOdoo({})
    await expect(odooSearchRecords(odoo, { modelo: 'res.partner', campos: ['mobile'] })).rejects.toThrow(/mobile/)
  })
})

describe('odoo_summarize_sales', () => {
  test('default: solo confirmadas, con el rango datetime expandido al día completo', async () => {
    const { odoo, calls } = fakeOdoo({
      'sale.order.read_group': [[
        { state: 'sale', state_count: 383, amount_untaxed: 6800000, amount_total: 7863084.2, __domain: [] },
        { state: 'done', state_count: 10, amount_untaxed: 90000, amount_total: 104400, __domain: [] },
      ]],
    })
    const result = await odooSummarizeSales(odoo, { desde: '2026-07-01', hasta: '2026-07-31' })

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
    await odooSummarizeSales(odoo, { incluir: 'todas', agrupar_por: 'vendedor' })
    expect(calls[0].payload.domain).toContainEqual(['state', '!=', 'cancel'])
    expect(calls[0].payload.groupby).toEqual(['user_id'])
  })
})
