/** MCP quotation tools. The Supabase client is passed as a parameter, so the
 *  project mock is injected directly (no vi.mock). */

import { describe, test, expect } from 'vitest'
import { createMockSupabase, hasFilter, filterValue, type CallRecord } from '../helpers/supabase-mock'
import { listQuotations, getQuotation, getQuotationStats } from '@/lib/mcp/tools/quotations'
import { ToolError } from '@/lib/mcp/core/errors'
import type { Db } from '@/lib/mcp/core/db'

const asDb = (c: ReturnType<typeof createMockSupabase>) => c as unknown as Db

const Q1 = '3f2a9c1b-5d7e-4a10-8b31-0123456789ab'
const O1 = '9e8d7c6b-1a2b-4c3d-8e4f-0123456789cd'

describe('listQuotations', () => {
  test('mapea lineas, el estado en español y el ref; aplica el filtro con el valor de la BD', async () => {
    const client = createMockSupabase({
      responses: {
        quotations: {
          data: [
            { id: Q1, name: 'Cot A', customer_name: 'ACME', status: 'approved', total_amount: 100, approved_at: '2026-07-01', created_at: '2026-06-30', quotation_items: [{ count: 3 }] },
          ],
          count: 1,
        },
      },
    })

    const result = await listQuotations(asDb(client), { estado: 'aprobada' })

    expect(result).toMatchObject({ total: 1, pagina: 1, por_pagina: 20, hay_mas: false })
    expect(result.cotizaciones).toEqual([
      { ref: '3f2a9c1b', nombre: 'Cot A', cliente: 'ACME', estado: 'aprobada', total_sellado: 100, lineas: 3, aprobada_el: '2026-07-01', creada_el: '2026-06-30' },
    ])
    const call = client.callsTo('quotations', 'select')[0]
    expect(filterValue(call, 'status')).toBe('approved')
  })

  test('pide la página que toca y avisa cuánto falta', async () => {
    const client = createMockSupabase({ responses: { quotations: { data: [], count: 45 } } })
    const result = await listQuotations(asDb(client), { pagina: 2, por_pagina: 20 })
    expect(result).toMatchObject({ total: 45, pagina: 2, por_pagina: 20, hay_mas: true, nota: 'Hay 25 más: pide pagina=3.' })
    expect(client.callsTo('quotations', 'select')[0].filters.find((f) => f.method === 'range')?.args).toEqual([20, 39])
  })

  test('un estado inválido es error, nunca un filtro ignorado (#155 C1); el token en inglés tampoco vale', async () => {
    const client = createMockSupabase({ responses: { quotations: { data: [], count: 0 } } })
    await expect(listQuotations(asDb(client), { estado: 'no-existe' })).rejects.toThrow(/Estado inválido "no-existe": usa borrador \| en_revision/)
    await expect(listQuotations(asDb(client), { estado: 'approved' })).rejects.toThrow(/Estado inválido/)
    expect(client.callsTo('quotations', 'select')).toEqual([])
  })

  test('sanitiza la búsqueda para .or()', async () => {
    const client = createMockSupabase({ responses: { quotations: { data: [], count: 0 } } })

    await listQuotations(asDb(client), { buscar: 'AC%M,E' })

    const call = client.callsTo('quotations', 'select')[0]
    expect(hasFilter(call, 'status')).toBe(false)
    const or = call.filters.find((f) => f.method === 'or')
    expect(or?.args[0]).not.toContain('%M') // % and , removed
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
    { id: 'i1', item_type: 'separator', section_label: 'Sección 1', unit_price: null, quantity: null },
    { id: 'i2', item_type: 'product', etm: 'E1', model_code: 'M1', brand: 'URREA', description: 'Desc', description_es: 'Desc ES', dymmsa_description: 'Oficial', unit_price: 10, quantity: 2, is_approved: true, is_sold: null, delivery_time: 'immediate', notes: null },
    { id: 'i3', item_type: 'product', etm: 'E2', model_code: 'M2', brand: 'URREA', description: 'D2', description_es: '', dymmsa_description: null, unit_price: 100, quantity: 1, is_approved: null, is_sold: false, delivery_time: null, notes: null },
  ]
  const row = (extra: Record<string, unknown> = {}) => ({
    id: Q1, name: 'Cot', customer_name: 'ACME', status: 'approved', notes: null, approved_at: null, created_at: '', updated_at: '2026-10-01T10:00:00Z', quotation_items: items, ...extra,
  })

  test('totales excluyen separadores y no-vendibles; total_aprobado solo aprobados; cada línea trae su número', async () => {
    const client = createMockSupabase({ responses: { quotations: { data: row() } } })

    const result = await getQuotation(asDb(client), Q1)

    // E2 has is_sold=false → excluded; separator excluded → total = 10*2
    expect(result).toMatchObject({ ref: '3f2a9c1b', estado: 'aprobada', total: 20, total_aprobado: 20, productos: 2, orden: null })
    expect(result.lineas[0]).toEqual({ linea: 1, tipo: 'seccion', titulo: 'Sección 1' })
    expect(result.lineas[1]).toMatchObject({ linea: 2, tipo: 'producto', etm: 'E1', importe: 20, descripcion: 'Desc ES', aprobacion: 'aprobada', se_vende: 'sin_definir', entrega: 'inmediata' })
    expect(result.lineas[2]).toMatchObject({ linea: 3, aprobacion: 'pendiente', se_vende: 'no', entrega: null })
    expect(JSON.stringify(result)).not.toContain(Q1)
  })

  test('la version cambia si cambia una línea o el documento, y no si no cambia nada', async () => {
    const version = async (extra: Record<string, unknown>) =>
      (await getQuotation(asDb(createMockSupabase({ responses: { quotations: { data: row(extra) } } })), Q1)).version
    const base = await version({})
    expect(base).toMatch(/^[0-9a-f]{12}$/)
    expect(await version({})).toBe(base)
    expect(await version({ updated_at: '2026-10-02T10:00:00Z' })).not.toBe(base)
    expect(await version({ quotation_items: items.slice(0, 2) })).not.toBe(base)
    expect(await version({ quotation_items: [items[1], items[0], items[2]] })).not.toBe(base)
  })

  test('acepta ref (8 hex), UUID o nombre, y varias coincidencias piden precisar con el ref de cada una', async () => {
    // A range read answers a list, the detail read one row: as PostgREST does.
    const byRef = createMockSupabase({ responses: { quotations: (rec: CallRecord) => ({ data: rec.filters.some((f) => f.method === 'gte') ? [row()] : row(), error: null }) } })
    await getQuotation(asDb(byRef), '3F2A9C1B')
    const lookup = byRef.callsTo('quotations', 'select')[0]
    expect(lookup.filters.find((f) => f.method === 'gte')?.args).toEqual(['id', '3f2a9c1b-0000-0000-0000-000000000000'])
    expect(lookup.filters.find((f) => f.method === 'lte')?.args).toEqual(['id', '3f2a9c1b-ffff-ffff-ffff-ffffffffffff'])

    const byName = createMockSupabase({ responses: { quotations: (rec: CallRecord) => ({ data: rec.filters.some((f) => f.method === 'or') ? [row(), row({ id: O1, name: 'Cot 2' })] : row(), error: null }) } })
    await expect(getQuotation(asDb(byName), 'Cot')).rejects.toThrow(/Hay 2 coincidencias \(Cot \(ACME\) \[ref 3f2a9c1b\], Cot 2 \(ACME\) \[ref 9e8d7c6b\]\) — repite con el nombre completo o con su ref/)
  })

  test('trae la orden en que se convirtió con su ref y estado en español (absorbe get_order_by_quotation, #134)', async () => {
    const client = createMockSupabase({
      responses: {
        quotations: { data: row({ status: 'converted_to_order', quotation_items: [] }) },
        orders: { data: { id: O1, name: 'Orden ACME', status: 'ordered' } },
      },
    })
    const result = await getQuotation(asDb(client), Q1)
    expect(result.estado).toBe('convertida')
    expect(result.orden).toEqual({ ref: '9e8d7c6b', nombre: 'Orden ACME', estado: 'pedida' })
  })

  test('PGRST116 → "Cotización no encontrada"', async () => {
    const client = createMockSupabase({
      // The lookup finds it; the detail read (the one with the lines) says it is gone.
      responses: { quotations: (rec: CallRecord) => (rec.columns?.startsWith('*') ? { data: null, error: { code: 'PGRST116', message: 'x' } } : { data: { id: Q1, name: 'C', customer_name: 'X', status: 'draft' }, error: null }) },
    })
    await expect(getQuotation(asDb(client), Q1)).rejects.toThrow('Cotización no encontrada')
  })

  test('un UUID que no existe lo dice sin pedir el detalle', async () => {
    const client = createMockSupabase({ responses: { quotations: { data: null, error: null } } })
    await expect(getQuotation(asDb(client), Q1)).rejects.toThrow('No encontré la cotización con ese id.')
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
