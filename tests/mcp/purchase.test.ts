/** MCP purchase plan tool (#109): the plan comes from purchase-plan.ts, the tool only digests it. */

import { describe, test, expect } from 'vitest'
import { createMockSupabase, filterValue } from '../helpers/supabase-mock'
import { type Db } from '@/lib/mcp/shared'
import { getPurchasePlan } from '@/lib/mcp/tools/purchase'

const asDb = (c: ReturnType<typeof createMockSupabase>) => c as unknown as Db

const ORDER_ID = '11111111-1111-4111-8111-111111111111'
const order = { id: ORDER_ID, name: 'ORD-12', customer_name: 'Andritz', status: 'ordered' }
const item = (id: string, model_code: string, brand: string, qty: number, price: number) => ({
  id, item_type: 'product', etm: null, model_code, brand, description: null, section_label: null, quantity_to_order: qty, unit_price: price,
})

describe('getPurchasePlan', () => {
  test('grupo de catálogo con matemática, recomendación y decisión guardada; grupo local sin matemática', async () => {
    const client = createMockSupabase({
      responses: {
        orders: { data: order, error: null },
        order_items: { data: [item('i1', '6954', 'URREA', 7, 100), item('i2', '6954', 'URREA', 5, 100), item('i3', 'LOCAL-1', 'DYMMSA', 3, 50)] },
        urrea_catalog: { data: [{ code: '6954', brand: 'URREA', description: 'Llave española', std: 10 }] },
        order_purchase_decisions: {
          data: [{ id: 'd1', order_id: ORDER_ID, model_code: '6954', brand: 'URREA', std_snapshot: 10, needed_qty: 12, packages_wholesale: 1, qty_retail: 2, created_at: '', updated_at: '' }],
        },
        app_settings: { data: [] },
      },
    })
    const result = await getPurchasePlan(asDb(client), { orden: ORDER_ID })

    expect(result.orden.nombre).toBe('ORD-12')
    expect(result.umbrales).toEqual({ dinero_parado_mxn: 100, pct_parado: 0.8 })
    expect(result.resumen).toMatchObject({ grupos_catalogo: 1, grupos_compra_local: 1, decididos: 1, desactualizados: 0 })

    // 7 + 5 consolidate to 12 BEFORE the math: 1 full package, remainder 2.
    const urrea = result.grupos.find((g) => g.codigo === '6954')!
    expect(urrea).toMatchObject({ origen: 'catálogo', necesita: 12, std: 10, descripcion: 'Llave española' })
    expect(urrea.matematica).toMatchObject({ paquetes_completos: 1, resto: 2, excedente_si_redondea: 8, dinero_parado: 800 })
    expect(urrea.recomendacion).toMatchObject({ paquetes_mayoreo: 1, piezas_menudeo: 2 })
    expect(urrea.decision_guardada).toEqual({ eleccion: 'mixto', paquetes_mayoreo: 1, piezas_menudeo: 2, desactualizada: false })

    const local = result.grupos.find((g) => g.codigo === 'LOCAL-1')!
    expect(local).toMatchObject({ origen: 'compra local', matematica: null, recomendacion: null, decision_guardada: null })
    expect(filterValue(client.callsTo('order_items', 'select')[0], 'order_id')).toBe(ORDER_ID)
  })

  test('decisión desactualizada cuando cambió la cantidad', async () => {
    const client = createMockSupabase({
      responses: {
        orders: { data: order, error: null },
        order_items: { data: [item('i1', '6954', 'URREA', 15, 100)] },
        urrea_catalog: { data: [{ code: '6954', brand: 'URREA', description: null, std: 10 }] },
        order_purchase_decisions: {
          data: [{ id: 'd1', order_id: ORDER_ID, model_code: '6954', brand: 'URREA', std_snapshot: 10, needed_qty: 12, packages_wholesale: 2, qty_retail: 0, created_at: '', updated_at: '' }],
        },
      },
    })
    const result = await getPurchasePlan(asDb(client), { orden: ORDER_ID })
    expect(result.grupos[0].decision_guardada).toMatchObject({ eleccion: 'mayoreo', desactualizada: true })
    expect(result.resumen.desactualizados).toBe(1)
  })
})
