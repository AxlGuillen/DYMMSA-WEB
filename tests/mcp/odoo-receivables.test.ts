/** Odoo block, phase 8 (#113): receivable ranking from Odoo's own per-customer figures (captured 2026-09-24). */

import { describe, test, expect } from 'vitest'
import type { OdooCaller } from '@/lib/odoo/client'
import { odooReceivablesRanking, receivableBlock } from '@/lib/mcp/tools/odoo/receivables'
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

const partner = (id: number, name: string, due: number, overdue: number, dso: number | false) => ({
  id, name, total_due: due, total_overdue: overdue, days_sales_outstanding: dso,
})

const CUSTOMERS = [
  partner(9, 'FieldCore Service Solutions International LLC', 997481.65, 56710.07, 74.26),
  partner(24, 'Andritz', 376024.81, 1390.26, 88.23),
  partner(17, 'GE POWER SERVICES MEXICO', 1451917.94, 334633.61, 109.61),
  partner(62, 'GRUPO INDUSTRIAL MURAB', 38195.99, 18730.74, 39.73),
  partner(25, 'FASTENAL MEXICO', 48687.52, 0, 55.8),
  partner(70, 'Cliente saldado', 0, 0, 12.4),
  partner(71, 'Cliente sin historial', 500, 500, false),
]

describe('receivableBlock', () => {
  test('digiere las cifras y redondea el DSO; false/ausente → null', () => {
    expect(receivableBlock(CUSTOMERS[1])).toEqual({ deuda_total: 376024.81, vencido: 1390.26, dias_promedio_de_pago: 88 })
    expect(receivableBlock({ total_due: false })).toEqual({ deuda_total: null, vencido: null, dias_promedio_de_pago: null })
  })
})

describe('odoo_receivables_ranking', () => {
  test('ordena por vencido y luego por deuda; los más lentos por DSO; ignora a los saldados', async () => {
    const { odoo, calls } = fakeOdoo({ 'res.partner.search_read': [CUSTOMERS] })
    const result = await odooReceivablesRanking(odoo, {})

    expect(calls).toHaveLength(1)
    expect(calls[0].payload).toMatchObject({ domain: [['customer_rank', '>', 0]], limit: 100, offset: 0 })
    // Computed fields are read explicitly and never ordered on the Odoo side.
    expect(calls[0].payload.order).toBe('customer_rank desc, id asc')

    expect(result.clientes_con_saldo).toBe(6)
    // Totals are rounded to cents (no float noise in the answer).
    expect(result.deuda_total).toBe(2912807.91)
    expect(result.vencido_total).toBe(411964.68)
    expect(result.por_vencido.map((c) => c.cliente)).toEqual([
      'GE POWER SERVICES MEXICO', 'FieldCore Service Solutions International LLC', 'GRUPO INDUSTRIAL MURAB',
      'Andritz', 'Cliente sin historial', 'FASTENAL MEXICO',
    ])
    expect(result.por_vencido[0]).toEqual({ cliente: 'GE POWER SERVICES MEXICO', deuda_total: 1451917.94, vencido: 334633.61, dias_promedio_de_pago: 110 })
    // No DSO → out of the slowness list, still in the overdue one.
    expect(result.mas_lentos.map((c) => c.cliente)).toEqual([
      'GE POWER SERVICES MEXICO', 'Andritz', 'FieldCore Service Solutions International LLC', 'FASTENAL MEXICO', 'GRUPO INDUSTRIAL MURAB',
    ])
    expect(result.mas_lentos[0]).toEqual({ cliente: 'GE POWER SERVICES MEXICO', dias_promedio_de_pago: 110, deuda_total: 1451917.94 })
    expect(result.nota).toBeNull()
    expect(result.universo).toMatch(/customer_rank > 0/)
  })

  test('limit recorta ambas listas; pagina por encima de 100 clientes; nombre nulo no revienta', async () => {
    const many = Array.from({ length: 100 }, (_, i) => partner(1000 + i, `C${i}`, 10, i, 5))
    const { odoo, calls } = fakeOdoo({ 'res.partner.search_read': [many, [{ ...partner(5000, 'Último', 999, 999, 1), name: false }]] })
    const result = await odooReceivablesRanking(odoo, { limit: 3 })
    expect(calls.map((c) => c.payload.offset)).toEqual([0, 100])
    expect(result.clientes_con_saldo).toBe(101)
    expect(result.por_vencido).toHaveLength(3)
    expect(result.por_vencido[0].cliente).toBe('Sin nombre')
    expect(result.mas_lentos).toHaveLength(3)
    expect(result.llamadas).toBe(2)
  })

  test('al tope de páginas un conteo decide si faltó alguien (sin falso aviso en múltiplos exactos)', async () => {
    const pages = Array.from({ length: 10 }, (_, p) => Array.from({ length: 100 }, (_, i) => partner(p * 100 + i + 1, `C${p * 100 + i}`, 1, 0, 1)))
    const exact = fakeOdoo({ 'res.partner.search_read': pages, 'res.partner.search_count': [1000] })
    const a = await odooReceivablesRanking(exact.odoo, {})
    expect(a).toMatchObject({ clientes_con_saldo: 1000, llamadas: 11, nota: null })

    const more = fakeOdoo({ 'res.partner.search_read': pages, 'res.partner.search_count': [1200] })
    const b = await odooReceivablesRanking(more.odoo, {})
    expect(b.nota).toMatch(/1000 clientes leídos de 1200/)
  })
})

describe('catálogo fase 8', () => {
  test('total_due/DSO se leen pidiéndolos explícito; filtrar u ordenar por ellos se rechaza', async () => {
    const { odoo } = fakeOdoo({ 'res.partner.search_read': [[CUSTOMERS[2]]] })
    const result = await odooQuery(odoo, { model: 'res.partner', fields: ['name', 'total_due', 'days_sales_outstanding'], limit: 1 })
    await expect(odooQuery(odoo, { model: 'res.partner', fields: ['credit'] })).rejects.toThrow(/no está en el catálogo/)
    expect(result.items[0].total_due).toBe(1451917.94)

    await expect(odooQuery(odoo, { model: 'res.partner', domain: [['total_overdue', '>', 0]] })).rejects.toThrow(/computado sin almacenar/)
    await expect(odooQuery(odoo, { model: 'res.partner', order: 'days_sales_outstanding desc' })).rejects.toThrow(/computado sin almacenar/)
  })
})
