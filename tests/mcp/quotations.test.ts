/**
 * Tools MCP de cotizaciones. El cliente Supabase se pasa por parámetro,
 * así que el mock del proyecto se inyecta directo (sin vi.mock).
 */

import { describe, test, expect } from 'vitest'
import { createMockSupabase, hasFilter, filterValue } from '../helpers/supabase-mock'
import { listQuotations, getQuotation, getQuotationStats } from '@/lib/mcp/tools/quotations'
import { ToolError, type Db } from '@/lib/mcp/shared'

const asDb = (c: ReturnType<typeof createMockSupabase>) => c as unknown as Db

describe('listQuotations', () => {
  test('mapea items_count y aplica filtro de status', async () => {
    const client = createMockSupabase({
      responses: {
        quotations: {
          data: [
            { id: 'q1', name: 'Cot A', customer_name: 'ACME', status: 'approved', total_amount: 100, approved_at: '2026-07-01', created_at: '2026-06-30', quotation_items: [{ count: 3 }] },
          ],
          count: 1,
        },
      },
    })

    const result = await listQuotations(asDb(client), { status: 'approved' })

    expect(result.quotations).toHaveLength(1)
    expect(result.quotations[0].items_count).toBe(3)
    expect(result.count).toBe(1)
    const call = client.callsTo('quotations', 'select')[0]
    expect(filterValue(call, 'status')).toBe('approved')
  })

  test('ignora status inválido y sanitiza la búsqueda para .or()', async () => {
    const client = createMockSupabase({ responses: { quotations: { data: [], count: 0 } } })

    await listQuotations(asDb(client), { status: 'no-existe', search: 'AC%M,E' })

    const call = client.callsTo('quotations', 'select')[0]
    expect(hasFilter(call, 'status')).toBe(false)
    const or = call.filters.find((f) => f.method === 'or')
    expect(or?.args[0]).not.toContain('%M') // % y , removidos
  })

  test('propaga error de BD como ToolError', async () => {
    const client = createMockSupabase({
      responses: { quotations: { data: null, error: { message: 'boom' } } },
    })
    await expect(listQuotations(asDb(client), {})).rejects.toThrow(ToolError)
  })
})

describe('getQuotation', () => {
  const items = [
    { item_type: 'separator', section_label: 'Sección 1', unit_price: null, quantity: null },
    { item_type: 'product', etm: 'E1', model_code: 'M1', brand: 'URREA', description: 'Desc', description_es: 'Desc ES', dymmsa_description: 'Oficial', unit_price: 10, quantity: 2, is_approved: true, is_sold: null, delivery_time: 'immediate', notes: null },
    { item_type: 'product', etm: 'E2', model_code: 'M2', brand: 'URREA', description: 'D2', description_es: '', dymmsa_description: null, unit_price: 100, quantity: 1, is_approved: null, is_sold: false, delivery_time: null, notes: null },
  ]

  test('totales excluyen separadores y no-vendibles; total_approved solo aprobados', async () => {
    const client = createMockSupabase({
      responses: {
        quotations: {
          data: { id: 'q1', name: 'Cot', customer_name: 'ACME', status: 'approved', notes: null, approved_at: null, created_at: '', updated_at: '', quotation_items: items },
        },
      },
    })

    const result = await getQuotation(asDb(client), 'q1')

    // E2 tiene is_sold=false → excluido; separador excluido → total = 10*2
    expect(result.total).toBe(20)
    expect(result.total_approved).toBe(20)
    expect(result.items_count).toBe(2) // productos, sin separador
    expect(result.items[0]).toEqual({ item_type: 'separator', section_label: 'Sección 1' })
    expect(result.items[1]).toMatchObject({ etm: 'E1', line_total: 20, description: 'Desc ES' })
  })

  test('PGRST116 → "Cotización no encontrada"', async () => {
    const client = createMockSupabase({
      responses: { quotations: { data: null, error: { code: 'PGRST116', message: 'x' } } },
    })
    await expect(getQuotation(asDb(client), 'nope')).rejects.toThrow('Cotización no encontrada')
  })
})

describe('getQuotationStats', () => {
  test('cuenta por status', async () => {
    const client = createMockSupabase({
      responses: {
        quotations: { data: [{ status: 'draft' }, { status: 'draft' }, { status: 'approved' }] },
      },
    })
    const stats = await getQuotationStats(asDb(client))
    expect(stats.draft).toBe(2)
    expect(stats.approved).toBe(1)
    expect(stats.rejected).toBe(0)
  })
})
