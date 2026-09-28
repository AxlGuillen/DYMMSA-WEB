/** MCP month closing (#109): egresos from the app, ingresos injected — Odoo absent degrades, never fails. */

import { describe, test, expect } from 'vitest'
import { createMockSupabase, filterValue, type CallRecord } from '../helpers/supabase-mock'
import { type Db } from '@/lib/mcp/shared'
import { getMonthClosing, type IncomeDeps } from '@/lib/mcp/tools/finance'
import { OdooError } from '@/lib/odoo/client'
import { todayInMexico } from '@/lib/format'

const asDb = (c: ReturnType<typeof createMockSupabase>) => c as unknown as Db

const MONTH = todayInMexico().slice(0, 7)
const payable = (status: string, amount: number, due: string, paidAt: string | null = null) => ({
  id: `${status}-${amount}`, supplier_id: 's1', concept: 'x', amount, invoice_date: due, due_date: due, status, paid_at: paidAt, notes: null, created_at: '', updated_at: '',
})

/** payables as the two reads see them, split by the status filter. */
function payables(pending: unknown[], paid: unknown[]) {
  return (rec: CallRecord) => ({ data: filterValue(rec, 'status') === 'pending' ? pending : paid, error: null })
}

const noOdoo: IncomeDeps = { configured: () => false, load: async () => { throw new Error('unreachable') } }

describe('getMonthClosing', () => {
  test('sin Odoo configurado: egresos completos, ingresos null con motivo, cierre solo egresos', async () => {
    const client = createMockSupabase({
      responses: { payables: payables([payable('pending', 300, `${MONTH}-20`)], [payable('paid', 1000, `${MONTH}-05`, `${MONTH}-05`)]) },
    })
    const result = await getMonthClosing(asDb(client), {}, noOdoo)
    expect(result.mes).toBe(MONTH)
    expect(result.egresos).toEqual({ pagado: 1000, pendiente_del_mes: 300, vencido_de_meses_anteriores: 0, truncado: false, nota: null })
    expect(result.ingresos).toBeNull()
    expect(result.ingresos_no_disponibles).toMatch(/no está configurado/)
    expect(result.cierre).toMatchObject({ real: -1000, proyectado: -1300 })
    expect(result.cierre.nota).toMatch(/solo refleja egresos/)
  })

  test('Odoo falla en la lectura: mismo degradado, sin romper', async () => {
    const client = createMockSupabase({ responses: { payables: payables([], []) } })
    const failing: IncomeDeps = { configured: () => true, load: async () => { throw new OdooError('boom') } }
    const result = await getMonthClosing(asDb(client), {}, failing)
    expect(result.ingresos).toBeNull()
    expect(result.ingresos_no_disponibles).toMatch(/No se pudo leer Odoo/)
  })

  test('con Odoo: cobrado entra al cierre real', async () => {
    const client = createMockSupabase({ responses: { payables: payables([], [payable('paid', 400, `${MONTH}-02`, `${MONTH}-02`)]) } })
    const live: IncomeDeps = {
      configured: () => true,
      load: async () => ({
        collections: { rows: [], truncated: false, fetchedAt: '2026-09-24T00:00:00Z' },
        open: { rows: [], truncated: false, fetchedAt: '2026-09-24T00:00:00Z' },
      }),
    }
    const result = await getMonthClosing(asDb(client), { mes: MONTH }, live)
    expect(result.ingresos).toMatchObject({ cobrado: 0, por_cobrar: 0, notas_credito_sin_aplicar: 0, truncado: false })
    expect(result.ingresos_no_disponibles).toBeNull()
    expect(result.cierre.real).toBe(-400)
  })

  test('mes inválido → error claro', async () => {
    const client = createMockSupabase({ responses: { payables: payables([], []) } })
    await expect(getMonthClosing(asDb(client), { mes: '2026/09' }, noOdoo)).rejects.toThrow(/Mes inválido/)
  })
})
