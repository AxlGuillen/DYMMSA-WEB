/** MCP cut plan tool (#109): net needs reuse cut-plan.ts; numerics arrive as strings. */

import { describe, test, expect } from 'vitest'
import { createMockSupabase, filterValue } from '../helpers/supabase-mock'
import { type Db } from '@/lib/mcp/shared'
import { getCutPlan } from '@/lib/mcp/tools/cutting'

const asDb = (c: ReturnType<typeof createMockSupabase>) => c as unknown as Db

const ORDER_ID = '11111111-1111-4111-8111-111111111111'
const order = { id: ORDER_ID, name: 'ORD-12', customer_name: 'Andritz', status: 'ordered' }

const tube = (id: string, diameter: string, length: string, quantity: number) => ({
  id, order_id: ORDER_ID, material_type: 'tube', diameter_mm: diameter, thickness_mm: null, width_mm: null,
  length_mm: length, quantity, requested_label: `tubo ${length}`, source_item_id: null, sort_order: 0, created_at: '', updated_at: '',
})

describe('getCutPlan', () => {
  test('agrupa por diámetro, calcula la necesidad neta con margen y empaca en cada barra capturada', async () => {
    const client = createMockSupabase({
      responses: {
        orders: { data: order, error: null },
        cut_plan_pieces: { data: [tube('p1', '25.4', '2000', 2), tube('p2', '25.4', '1500', 1)] },
        material_presentations: {
          data: [
            { id: 'm1', material_type: 'tube', diameter_mm: '25.4', thickness_mm: null, width_mm: null, length_mm: '6000', last_used_at: '', created_at: '' },
            { id: 'm2', material_type: 'tube', diameter_mm: '12.7', thickness_mm: null, width_mm: null, length_mm: '6000', last_used_at: '', created_at: '' },
          ],
        },
        app_settings: { data: [{ key: 'cut_margin_mm', value: 20 }] },
      },
    })
    const result = await getCutPlan(asDb(client), { orden: ORDER_ID })

    expect(result.orden).toMatchObject({ nombre: 'ORD-12', cliente: 'Andritz' })
    expect(result.margen_por_corte_mm).toBe(20)
    expect(result.tubos).toHaveLength(1)
    const group = result.tubos[0]
    // (2000+20)×2 + (1500+20)×1 — the purchase figure over-estimates on purpose.
    expect(group).toMatchObject({ diametro_mm: 25.4, unidades: 3, largo_neto_mm: 5560 })
    expect(group.piezas[0]).toEqual({ largo_mm: 2000, cantidad: 2, pedido_como: 'tubo 2000' })
    // Only the 25.4 bar applies; (2000+20)×2 + (1500+20) = 5560 fits in one 6000 bar.
    expect(group.opciones).toEqual([{ barra_mm: 6000, barras: 1, sobrante_total_mm: 440, no_caben: [] }])
    expect(result.placas).toEqual([])
    expect(filterValue(client.callsTo('cut_plan_pieces', 'select')[0], 'order_id')).toBe(ORDER_ID)
  })

  test('sin piezas lo dice; hoja de placa con rotación permitida', async () => {
    const empty = createMockSupabase({ responses: { orders: { data: order, error: null }, cut_plan_pieces: { data: [] } } })
    expect((await getCutPlan(asDb(empty), { orden: ORDER_ID })).nota).toMatch(/no tiene lista de corte/)

    const plate = createMockSupabase({
      responses: {
        orders: { data: order, error: null },
        cut_plan_pieces: {
          data: [{ ...tube('p1', null as unknown as string, '100', 1), material_type: 'plate', thickness_mm: '5', width_mm: '200', diameter_mm: null }],
        },
        material_presentations: {
          data: [{ id: 'm1', material_type: 'plate', diameter_mm: null, thickness_mm: '5', width_mm: '150', length_mm: '400', last_used_at: '', created_at: '' }],
        },
      },
    })
    const result = await getCutPlan(asDb(plate), { orden: ORDER_ID })
    // 200 wide × 100 long only fits the 150-wide sheet rotated (#81).
    expect(result.placas[0]).toMatchObject({ espesor_mm: 5, ancho_minimo_mm: 200, opciones: [{ hoja: '150×400 mm', hojas: 1, no_caben: [] }] })
  })

  test('resuelve la orden por nombre parcial y pide precisar con varias', async () => {
    const client = createMockSupabase({
      responses: {
        orders: { data: [{ ...order, id: 'a' }, { ...order, id: 'b', name: 'ORD-13' }] },
      },
    })
    await expect(getCutPlan(asDb(client), { orden: 'andritz' })).rejects.toThrow(/2 coincidencias \(ORD-12 \(Andritz\), ORD-13 \(Andritz\)\)/)
  })
})
