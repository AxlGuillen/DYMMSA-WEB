/**
 * Strict input through the real SDK (#155 C1, ADR-041): an unknown field, a value outside the enum or a
 * date that does not exist is an isError in Spanish, never dropped in silence, on both connectors.
 */

import { describe, test, expect, vi, beforeEach } from 'vitest'
import type { MockSupabaseClient } from '../helpers/supabase-mock'

const state = vi.hoisted(() => ({ db: null as unknown as MockSupabaseClient }))

vi.mock('@/lib/mcp/core/auth/supabase', () => ({ clientForToken: vi.fn(() => state.db), verifierClient: vi.fn() }))
vi.mock('@/lib/odoo/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/odoo/client')>()),
  callOdoo: vi.fn(async () => []),
}))

import { callOdoo } from '@/lib/odoo/client'
import { odooConnector } from '@/lib/mcp/connectors/odoo/connector'
import { parseInput } from '@/lib/mcp/core/schema'
import { listQuotationsTool } from '@/lib/mcp/connectors/dymmsa/quotations/list-quotations'
import { createMockSupabase } from '../helpers/supabase-mock'
import { authAs, connectMcp, textOf, type McpHarness } from './harness'

beforeEach(() => {
  state.db = createMockSupabase({ responses: { quotations: { data: [], count: 0 } } })
  vi.mocked(callOdoo).mockClear()
})

async function withMcp<T>(connect: Promise<McpHarness>, fn: (mcp: McpHarness) => Promise<T>): Promise<T> {
  const mcp = await connect
  try {
    return await fn(mcp)
  } finally {
    await mcp.close()
  }
}

describe('conector DYMMSA-WEB', () => {
  const dymmsa = () => connectMcp('admin')

  test('una entrada válida llega a la tool', async () => {
    const result = await withMcp(dymmsa(), (mcp) => mcp.call('list_quotations', { estado: 'aprobada', buscar: 'GE' }))
    expect(result.isError).toBeFalsy()
    expect(JSON.parse(textOf(result))).toMatchObject({ cotizaciones: [], total: 0 })
    expect(state.db.callsTo('quotations')).toHaveLength(1)
  })

  test('un campo desconocido es error en español con los campos válidos y un ejemplo, sin leer la BD', async () => {
    const result = await withMcp(dymmsa(), (mcp) => mcp.call('list_quotations', { estdo: 'borrador', buscar: 'GE' }))
    expect(result.isError).toBe(true)
    // The SDK's English prefix never reaches the model: the message is ours alone.
    expect(textOf(result)).toBe(
      'Entrada inválida en list_quotations: el campo «estdo» no existe (¿quisiste decir «estado»?). ' +
        'Campos válidos: estado, buscar, pagina, por_pagina. Ej.: {"buscar":"GE","estado":"borrador"}',
    )
    expect(state.db.callsTo('quotations')).toEqual([])
  })

  test('un estado fuera del enum es error, nunca un filtro ignorado', async () => {
    // The DB's own token is not one of the assistant's.
    const result = await withMcp(dymmsa(), (mcp) => mcp.call('list_quotations', { estado: 'approved' }))
    expect(result.isError).toBe(true)
    expect(textOf(result)).toMatch(/^Entrada inválida en list_quotations: «estado»: Opción inválida: se esperaba una de "borrador"\|"en_revision"/)
    expect(textOf(result)).toMatch(/Corrige ese valor y repite la llamada\. Ej\.: \{"estado":"borrador"\}$/)
    expect(state.db.callsTo('quotations')).toEqual([])
  })

  test('una fecha que no existe (2026-02-30) es error antes de tocar la BD', async () => {
    const result = await withMcp(dymmsa(), (mcp) => mcp.call('get_week_hours', { fecha: '2026-02-30' }))
    expect(result.isError).toBe(true)
    expect(textOf(result)).toMatch(/^Entrada inválida en get_week_hours: «fecha»: no es una fecha que exista \(YYYY-MM-DD\)\./)
    expect(state.db.callsTo('time_entries')).toEqual([])
  })

  test('un mes mal escrito y un campo anidado desconocido también se rechazan', async () => {
    const month = await withMcp(dymmsa(), (mcp) => mcp.call('get_payables_overview', { mes: '2026-13' }))
    expect(textOf(month)).toMatch(/^Entrada inválida en get_payables_overview: «mes»: no es un mes \(YYYY-MM\)/)

    const nested = await withMcp(dymmsa(), (mcp) =>
      mcp.call('save_payroll_hours', { dias: [{ empleado: 'Juan', fecha: '2026-10-20', horas: 8, hora_extra: 2 }] }),
    )
    expect(nested.isError).toBe(true)
    expect(textOf(nested)).toMatch(/el campo «hora_extra» no existe en «dias\.0»/)
    expect(textOf(nested)).toMatch(/Campos válidos en «dias\.0»: empleado, fecha, horas, horas_no_trabajadas, nota; obligatorios: empleado, fecha, horas\./)
  })

  test('falta un obligatorio: lo dice y el ejemplo lo trae', async () => {
    const result = await withMcp(dymmsa(), (mcp) => mcp.call('get_payable', {}))
    expect(textOf(result)).toBe('Entrada inválida en get_payable: falta «factura», que es obligatorio. Agrega lo que falta y repite la llamada. Ej.: {"factura":"texto"}')
  })

  test('una llamada directa (parseInput) da el mismo mensaje que el SDK', async () => {
    const viaSdk = await withMcp(dymmsa(), (mcp) => mcp.call('list_quotations', { estatus: 'borrador' }))
    expect(() => parseInput('list_quotations', listQuotationsTool.input, { estatus: 'borrador' })).toThrow(textOf(viaSdk))
  })
})

describe('conector Odoo DYMMSA', () => {
  const odoo = () => connectMcp('admin', authAs('admin'), odooConnector)

  test('una entrada válida (parámetros en español) llega a Odoo', async () => {
    const result = await withMcp(odoo(), (mcp) =>
      mcp.call('odoo_summarize_invoices', { desde: '2026-07-01', hasta: '2026-07-31', agrupar_por: 'mes' }),
    )
    expect(result.isError).toBeFalsy()
    expect(JSON.parse(textOf(result))).toMatchObject({ periodo: { desde: '2026-07-01', hasta: '2026-07-31' }, agrupado_por: 'mes' })
    expect(vi.mocked(callOdoo).mock.calls[0][2]).toMatchObject({ groupby: ['invoice_date:month'] })
  })

  test('un nombre viejo en inglés (date_from) es error con los campos nuevos, sin llamar a Odoo', async () => {
    const result = await withMcp(odoo(), (mcp) => mcp.call('odoo_summarize_invoices', { date_from: '2026-07-01' }))
    expect(result.isError).toBe(true)
    expect(textOf(result)).toMatch(/^Entrada inválida en odoo_summarize_invoices: el campo «date_from» no existe\. Campos válidos: desde, hasta, agrupar_por\./)
    expect(callOdoo).not.toHaveBeenCalled()
  })

  test('un valor fuera del enum es error', async () => {
    const result = await withMcp(odoo(), (mcp) => mcp.call('odoo_summarize_sales', { agrupar_por: 'semana' }))
    expect(result.isError).toBe(true)
    expect(textOf(result)).toMatch(/«agrupar_por»: Opción inválida: se esperaba una de "estado"\|"cliente"\|"vendedor"\|"mes"/)
    expect(callOdoo).not.toHaveBeenCalled()
  })

  test('una fecha que no existe (2026-02-30) es error antes de leer Odoo', async () => {
    const result = await withMcp(odoo(), (mcp) => mcp.call('odoo_get_customer', { cliente: 'GE', vence_desde: '2026-02-30' }))
    expect(result.isError).toBe(true)
    expect(textOf(result)).toMatch(/^Entrada inválida en odoo_get_customer: «vence_desde»: no es una fecha que exista/)
    expect(textOf(result)).toMatch(/Ej\.: \{"cliente":"GE","vence_desde":"2026-01-31"\}$/)
    expect(callOdoo).not.toHaveBeenCalled()
  })

  test('las primitivas usan modelo/filtros/campos/limite y rechazan los nombres de la API de Odoo', async () => {
    const ok = await withMcp(odoo(), (mcp) => mcp.call('odoo_search_records', { modelo: 'hr.employee', campos: ['name'], limite: 1 }))
    expect(ok.isError).toBeFalsy()
    expect(vi.mocked(callOdoo).mock.calls[0].slice(0, 2)).toEqual(['hr.employee', 'search_read'])

    const old = await withMcp(odoo(), (mcp) => mcp.call('odoo_search_records', { model: 'hr.employee', limit: 1 }))
    expect(textOf(old)).toMatch(/los campos «model», «limit» no existen \(¿quisiste decir «modelo», «limite»\?\)/)
    // The example is the caller's own call with the names fixed.
    expect(textOf(old)).toMatch(/Ej\.: \{"modelo":"hr\.employee","limite":1\}$/)
  })
})
