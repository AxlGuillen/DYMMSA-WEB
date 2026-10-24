/** odoo_get_customer (#155, ADR-041): the profile and the account statement of one customer, exact match first. */

import { describe, test, expect } from 'vitest'
import { odooGetCustomer } from '@/lib/mcp/tools/odoo/customers'
import { ToolError } from '@/lib/mcp/core/errors'
import { fakeOdoo } from '../helpers/fake-odoo'

const ANDRITZ = {
  id: 24,
  name: 'Andritz',
  vat: 'AHY9601017X4',
  active: true,
  email: 'contact-hydro.mx@andritz.com',
  phone: '+52 443 323 1530',
  city: 'Morelia',
  country_id: [156, 'Mexico'],
  // #113 (captured 2026-09-24): Odoo's receivable figures, computed per partner.
  total_due: 376024.81,
  total_overdue: 1390.26,
  days_sales_outstanding: 88.23042550254195,
}
const HYDRO = { ...ANDRITZ, id: 99, name: 'Andritz Hydro', vat: false }
const BRASIL = { ...ANDRITZ, id: 100, name: 'Andritz Brasil', vat: false }

// Far past / far future so the "today" of the run never flips a status.
const OPEN = (o: Record<string, unknown>) => ({
  id: 1, name: 'F1', move_type: 'out_invoice', partner_id: [24, 'Andritz'], invoice_date: '2020-01-01', invoice_date_due: '2020-02-01',
  amount_total: 100, amount_residual: 100, payment_state: 'not_paid', currency_id: [33, 'MXN'], ...o,
})
const MOVES = [
  OPEN({ id: 1, name: 'F-VIEJA', invoice_date_due: '2020-02-01', amount_residual: 100 }),
  OPEN({ id: 2, name: 'F-FUTURA', invoice_date_due: '2099-03-01', amount_residual: 40, amount_total: 50 }),
  OPEN({ id: 3, name: 'RINV1', move_type: 'out_refund', amount_residual: 30 }),
]
const SALES = [
  { state: 'sale', state_count: 80, amount_total: 900000, __domain: [] },
  { state: 'draft', state_count: 5, amount_total: 50000, __domain: [] },
]
const INVOICING = [
  { payment_state: 'paid', payment_state_count: 60, amount_total: 700000, amount_residual: 0, __domain: [] },
  { payment_state: 'not_paid', payment_state_count: 2, amount_total: 150, amount_residual: 140, __domain: [] },
]

const script = (partners: unknown[][], moves: unknown[] = MOVES) => ({
  'res.partner.search_read': partners,
  'account.move.search_read': [moves],
  'sale.order.read_group': [SALES],
  'account.move.read_group': [INVOICING],
})

describe('odoo_get_customer', () => {
  test('exacto primero; expediente y estado de cuenta en 4 llamadas, con la cifra neta solo como cartera_contable', async () => {
    const { odoo, calls } = fakeOdoo(script([[ANDRITZ, HYDRO]]))
    const result = await odooGetCustomer(odoo, { cliente: 'andritz' })

    expect(calls.map((c) => `${c.model}.${c.method}`)).toEqual([
      'res.partner.search_read', 'account.move.search_read', 'sale.order.read_group', 'account.move.read_group',
    ])
    expect(calls[0].payload.domain).toEqual([['name', 'ilike', 'andritz']])
    expect(calls[0].payload.fields).toEqual(expect.arrayContaining(['name', 'vat', 'total_due', 'total_overdue', 'days_sales_outstanding']))
    // The statement reads only this partner's open moves; sales and invoicing filter by the same id.
    expect(calls[1].payload.domain).toEqual(expect.arrayContaining([['move_type', 'in', ['out_invoice', 'out_refund']], ['partner_id', '=', 24]]))
    for (const call of calls.slice(2)) expect(call.payload.domain).toContainEqual(['partner_id', '=', 24])

    expect(result.cliente).toEqual({
      id: '#24', nombre: 'Andritz', rfc: 'AHY9601017X4', correo: 'contact-hydro.mx@andritz.com',
      telefono: '+52 443 323 1530', ciudad: 'Morelia', pais: 'Mexico',
    })
    // Screen default: everything overdue + this month, both kinds — the 2099 invoice is outside.
    expect(result.estado_de_cuenta).toMatchObject({
      incluye: 'ambas', rango: expect.stringMatching(/^Vence hasta el \d{4}-\d{2}-\d{2}$/),
      total_por_cobrar: 100, total_vencido: 100, total_por_vencer: 0, facturas: 1, truncado: false,
    })
    expect(result.estado_de_cuenta.detalle.map((l) => [l.folio, l.estado, l.saldo, l.moneda])).toEqual([['F-VIEJA', 'vencida', 100, 'MXN']])
    // Credit apart, never subtracted from the statement (#102).
    expect(result.notas_credito_sin_aplicar).toEqual({
      total: 30, documentos: 1, monedas_sin_convertir: undefined, ultimas: [{ folio: 'RINV1', fecha: '2020-01-01', saldo: 30, moneda: 'MXN' }],
    })
    expect(result.cartera_contable).toMatchObject({ deuda_total: 376024.81, vencido: 1390.26, dias_promedio_de_pago: 88 })
    expect(result.cartera_contable.nota).toMatch(/neto de notas de crédito.*no lo cuadres contra estado_de_cuenta/)
    expect(result.ventas.total_confirmado).toBe(900000)
    expect(result.facturacion).toMatchObject({ total_facturado: 700150, total_pendiente: 140 })
    expect(result.nota).toBeUndefined()
  })

  test('con fechas o incluir manda el rango por VENCIMIENTO (ambas por default)', async () => {
    const windowed = await odooGetCustomer(fakeOdoo(script([[ANDRITZ]])).odoo, { cliente: 'Andritz', vence_desde: '2099-01-01', vence_hasta: '2099-12-31' })
    expect(windowed.estado_de_cuenta).toMatchObject({ incluye: 'ambas', rango: 'Vence del 2099-01-01 al 2099-12-31', total_por_cobrar: 40, facturas: 1 })

    const everything = await odooGetCustomer(fakeOdoo(script([[ANDRITZ]])).odoo, { cliente: 'Andritz', incluir: 'ambas' })
    expect(everything.estado_de_cuenta).toMatchObject({ rango: 'Todas las fechas de vencimiento', total_por_cobrar: 140, total_por_vencer: 40, facturas: 2 })

    const overdueOnly = await odooGetCustomer(fakeOdoo(script([[ANDRITZ]])).odoo, { cliente: 'Andritz', incluir: 'vencidas', vence_desde: '2099-01-01' })
    expect(overdueOnly.estado_de_cuenta).toMatchObject({ incluye: 'vencidas', total_por_cobrar: 0, facturas: 0 })
  })

  test('varias coincidencias sin exacta → error que las lista; ninguna → error, nunca un éxito vacío', async () => {
    const ambiguous = fakeOdoo(script([[HYDRO, BRASIL]]))
    const error = await odooGetCustomer(ambiguous.odoo, { cliente: 'andritz h' }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ToolError)
    expect((error as Error).message).toMatch(/Hay 2 coincidencias \(Andritz Hydro \(#99\), Andritz Brasil \(#100\)\)/)
    expect(ambiguous.calls).toHaveLength(1)

    // Neither active nor archived: an error that says how to search, before reading anything else.
    const missing = fakeOdoo(script([[], []]))
    await expect(odooGetCustomer(missing.odoo, { cliente: 'Empresa Fantasma' })).rejects.toThrow(/No hay ningún cliente en Odoo que coincida con "Empresa Fantasma".*#id/)
    expect(missing.calls.every((c) => c.model === 'res.partner')).toBe(true)
  })

  test('por #id o RFC; un cliente archivado se consulta igual y lo avisa', async () => {
    const byId = fakeOdoo(script([[ANDRITZ]]))
    await odooGetCustomer(byId.odoo, { cliente: '#24' })
    expect(byId.calls[0].payload.domain).toEqual([['id', '=', 24]])

    const byRfc = fakeOdoo(script([[ANDRITZ]]))
    await odooGetCustomer(byRfc.odoo, { cliente: 'ahy9601017x4' })
    expect(byRfc.calls[0].payload.domain).toEqual([['vat', '=', 'AHY9601017X4'], '|', ['is_company', '=', true], ['parent_id', '=', false]])

    // An archived customer may still owe: the statement is read, never refused.
    const archived = fakeOdoo(script([[], [{ ...ANDRITZ, active: false }]]))
    const result = await odooGetCustomer(archived.odoo, { cliente: 'Andritz' })
    expect(archived.calls[1].payload.context).toEqual({ active_test: false })
    expect(result.nota).toMatch(/archivado/)
    expect(result.estado_de_cuenta.total_por_cobrar).toBe(100)
  })

  test('una factura en dólares se suma sin convertir y se avisa; más de 50 facturas se recortan con truncado', async () => {
    const usd = [...MOVES, OPEN({ id: 7, name: 'F-USD', currency_id: [2, 'USD'], amount_residual: 10 })]
    const result = await odooGetCustomer(fakeOdoo(script([[ANDRITZ]], usd)).odoo, { cliente: 'Andritz' })
    expect(result.estado_de_cuenta).toMatchObject({ total_por_cobrar: 110, monedas_sin_convertir: ['USD'] })

    const many = Array.from({ length: 60 }, (_, i) => OPEN({ id: i + 1, name: `F${String(i).padStart(3, '0')}`, amount_residual: 1 }))
    const long = await odooGetCustomer(fakeOdoo(script([[ANDRITZ]], many)).odoo, { cliente: 'Andritz' })
    expect(long.estado_de_cuenta).toMatchObject({ facturas: 60, total_por_cobrar: 60, truncado: true })
    expect(long.estado_de_cuenta.detalle).toHaveLength(50)
  })

  test('fecha inexistente o rango invertido → error antes de llamar a Odoo', async () => {
    const { odoo, calls } = fakeOdoo({})
    await expect(odooGetCustomer(odoo, { cliente: 'Andritz', vence_hasta: '2026-02-30' })).rejects.toThrow(/inexistente/)
    await expect(odooGetCustomer(odoo, { cliente: 'Andritz', vence_desde: '2026-11-01', vence_hasta: '2026-10-01' })).rejects.toThrow(/Rango invertido/)
    await expect(odooGetCustomer(odoo, { cliente: '  ' })).rejects.toThrow(/Indica el cliente/)
    expect(calls).toHaveLength(0)
  })
})
