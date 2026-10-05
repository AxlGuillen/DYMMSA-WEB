/** Delivery format (2026-10-05): pesos on every amount, the brand in Comments, Spanish description or Translate. */

import { describe, test, expect } from 'vitest'
import * as XLSX from 'xlsx'
import { deliveryDescription, generateDeliveryExcel } from '@/lib/excel/generator'
import type { OrderItem } from '@/types/database'

const item = (over: Partial<OrderItem>): OrderItem => ({
  id: 'i1', order_id: 'o1', item_type: 'product', section_label: null, separator_color: null, sort_order: 0,
  etm: 'ETM-1', model_code: '7470P', description: 'Pliers 10"', brand: 'URREA',
  quantity_approved: 1, quantity_in_stock: 1, quantity_to_order: 0, quantity_received: 0,
  urrea_status: 'supplied', delivery_time: 'immediate', unit_price: 462, location: null, created_at: '',
  ...over,
})

async function readSheet(blob: Blob) {
  const wb = XLSX.read(new Uint8Array(await blob.arrayBuffer()), { type: 'array', cellNF: true })
  return wb.Sheets.Entrega
}

describe('deliveryDescription', () => {
  test('la descripción en español de la tabla ETM gana; sin ella se duplica la de Translate', () => {
    expect(deliveryDescription({ etm: 'A', description: 'Pliers' }, { A: 'Pinza de presión' })).toBe('Pinza de presión')
    expect(deliveryDescription({ etm: 'B', description: 'Pliers' }, { A: 'Pinza' })).toBe('Pliers')
    expect(deliveryDescription({ etm: 'C', description: 'Pliers' }, { C: '   ' })).toBe('Pliers')
  })
})

describe('generateDeliveryExcel', () => {
  test('descripción, marca en Comments y signo de pesos en precio, total, subtotal, IVA y total', async () => {
    const blob = generateDeliveryExcel(
      [item({}), item({ id: 'i2', etm: 'ETM-2', model_code: '7414MT', description: 'Socket', brand: 'SURTEK', unit_price: 80 })],
      'Cliente',
      { 'ETM-1': 'Pinza de presión 10"' },
    )
    const ws = await readSheet(blob)
    expect(ws.C2.v).toBe('Pinza de presión 10"')
    expect(ws.D2.v).toBe('Pliers 10"')
    expect(ws.C3.v).toBe('Socket')
    expect(ws.H2.v).toBe('URREA')
    expect(ws.H3.v).toBe('SURTEK')

    for (const ref of ['F2', 'G2', 'F3', 'G3', 'G5', 'G6', 'G7']) {
      expect(ws[ref].t, ref).toBe('n')
      expect(ws[ref].z, ref).toBe('"$"#,##0.00')
    }
    expect(ws.G5.v).toBe(542)
    expect(ws.G7.v).toBeCloseTo(628.72)
    expect(ws.F5.v).toBe('Subtotal:')
  })
})
