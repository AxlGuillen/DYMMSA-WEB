/**
 * odoo_save_product (#144, ADR-040). The authorization comes from the real
 * preview; the real facade and write catalog run over fakes: nothing reaches Odoo nor Supabase.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { createMockSupabase } from '../helpers/supabase-mock'
import { fakeOdoo, fakeWriter, throwingWriter, type OdooScript } from '../helpers/fake-odoo'
import { odooPreviewQuotation, type QuotationLineInput, type QuotationPreview } from '@/lib/mcp/tools/odoo/quotations'
import { odooSaveProduct, SAT_PLACEHOLDER, type SaveProductInput } from '@/lib/mcp/tools/odoo/products-write'
import { splitResultMeta, type Db } from '@/lib/mcp/shared'
import { OdooUncertainWriteError } from '@/lib/odoo/client'
import {
  PRODUCTS_AUTHORIZATION_META,
  PRODUCTS_CHANGED_MESSAGE,
  PRODUCTS_EXPIRED_MESSAGE,
  PRODUCTS_OTHER_ADMIN_MESSAGE,
  PRODUCTS_UNAUTHORIZED_MESSAGE,
} from '@/lib/odoo/preview-token'
import { ADMIN_ONLY_MESSAGE } from '@/lib/odoo/write-guard'
import type { McpRole } from '@/lib/mcp/manifest'

const NOW = Date.UTC(2026, 9, 17, 23, 0)

beforeEach(() => {
  vi.stubEnv('ODOO_URL', 'https://odoo.test')
  vi.stubEnv('ODOO_WRITE_API_KEY', 'write-key-0123456789abcdef')
  vi.stubEnv('ODOO_DB', '')
  // One clock for the proof, the authorization and the writer (#144).
  vi.useFakeTimers({ toFake: ['Date'], now: NOW })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

function context(opts: { role?: McpRole; profileRole?: string; userId?: string } = {}) {
  const client = createMockSupabase({
    responses: { profiles: { data: { role: opts.profileRole ?? 'admin', display_name: 'Ana Admin' } } },
  })
  return { ctx: { db: client as unknown as Db, userId: opts.userId ?? 'admin-1', role: opts.role ?? 'admin' } }
}

const COMPANY = { id: 1, name: 'DISTRIBUCIONES Y MANUFACTURAS DE MICHOACAN', vat: 'DMM020826363', active: true }

const ZZTEST_LINE: QuotationLineInput = {
  codigo: 'ZZTEST144',
  descripcion: 'Producto de prueba del asistente',
  marca: 'PRUEBA',
  cantidad: 1,
  precio: 1,
}
const PINZA_LINE: QuotationLineInput = {
  codigo: '7230',
  descripcion: 'Pinza de punta larga',
  marca: 'surtek',
  etm: '510099001',
  clave_sat: '27112100',
  cantidad: 2,
  precio: 120,
}

const ZZTEST_NAME = 'ZZTEST144 Producto de prueba del asistente PRUEBA'
const PINZA_NAME = '7230 Pinza de punta larga SURTEK'

/** The real preview: what the view sends to odoo_save_product, plus the quotation key the model sees. */
async function previewKeys(lineas: QuotationLineInput[], ctx = context().ctx): Promise<{ input: SaveProductInput; clave: string }> {
  const { odoo } = fakeOdoo({
    'res.partner.search_read': [[COMPANY]],
    'product.product.search_read': [[]],
    'sale.order.search_read': [[]],
  })
  const { writer, attempts } = throwingWriter()
  const { data, meta } = splitResultMeta(await odooPreviewQuotation({ reader: odoo, writer }, ctx, { cliente: '#1', lineas }))
  expect(attempts).toEqual([])
  const preview = data as QuotationPreview
  const autorizacion = meta?.[PRODUCTS_AUTHORIZATION_META]
  expect(autorizacion).toEqual(expect.any(String))
  expect(preview.clave).toEqual(expect.any(String))
  return { input: { productos: [...preview.productos_para_alta], autorizacion: autorizacion as string }, clave: preview.clave as string }
}

const authorize = async (lineas: QuotationLineInput[] = [ZZTEST_LINE, PINZA_LINE], ctx = context().ctx) =>
  (await previewKeys(lineas, ctx)).input

const saveScript = (overrides: OdooScript = {}): OdooScript => ({
  'product.product.search_read': [[]],
  'product.unspsc.code.search_read': [[{ id: 900, code: '27112100' }]],
  ...overrides,
})

describe('autorización', () => {
  test('sin autorización de la vista no crea productos', async () => {
    const { input, clave } = await previewKeys([ZZTEST_LINE, PINZA_LINE])
    const { productos } = input
    const cases: [string, unknown][] = [
      ['vacía', '  '],
      ['ausente', undefined],
      ['inventada', 'x.y'],
      // Same secret, other kind: the quotation key the model does see never creates products.
      ['clave de cotización', clave],
    ]
    for (const [label, autorizacion] of cases) {
      const { odoo, calls } = fakeOdoo({})
      const { writer, ops } = fakeWriter()
      const input = { productos, autorizacion } as SaveProductInput
      await expect(odooSaveProduct({ reader: odoo, writer }, context().ctx, input), label).rejects.toThrow(PRODUCTS_UNAUTHORIZED_MESSAGE)
      expect(calls, label).toEqual([])
      expect(ops, label).toEqual([])
    }

    // A member or a demoted admin never gets as far as the authorization.
    for (const who of [context({ role: 'member' }), context({ profileRole: 'member' })]) {
      const { odoo, calls } = fakeOdoo({})
      const { writer, attempts } = throwingWriter()
      await expect(odooSaveProduct({ reader: odoo, writer }, who.ctx, { productos, autorizacion: 'x.y' })).rejects.toThrow(
        ADMIN_ONLY_MESSAGE,
      )
      expect(calls).toEqual([])
      expect(attempts).toEqual([])
    }
  })

  test('autorización de otra lista u otro usuario → nada escrito', async () => {
    const signed = await authorize()
    const foreign = await authorize(undefined, context({ userId: 'admin-2' }).ctx)
    const cases: [string, SaveProductInput, string][] = [
      ['otro precio', { ...signed, productos: [{ ...signed.productos[0], precio: 2 }, signed.productos[1]] }, PRODUCTS_CHANGED_MESSAGE],
      ['un producto menos', { ...signed, productos: signed.productos.slice(0, 1) }, PRODUCTS_CHANGED_MESSAGE],
      ['otro orden', { ...signed, productos: [...signed.productos].reverse() }, PRODUCTS_CHANGED_MESSAGE],
      ['de otro administrador', foreign, PRODUCTS_OTHER_ADMIN_MESSAGE],
    ]
    for (const [label, input, message] of cases) {
      const { odoo, calls } = fakeOdoo({})
      const { writer, ops } = fakeWriter()
      await expect(odooSaveProduct({ reader: odoo, writer }, context().ctx, input), label).rejects.toThrow(message)
      expect(calls, label).toEqual([])
      expect(ops, label).toEqual([])
    }

    vi.setSystemTime(NOW + 31 * 60_000)
    const { odoo, calls } = fakeOdoo({})
    const { writer, ops } = fakeWriter()
    await expect(odooSaveProduct({ reader: odoo, writer }, context().ctx, signed)).rejects.toThrow(PRODUCTS_EXPIRED_MESSAGE)
    expect(calls).toEqual([])
    expect(ops).toEqual([])
  })

  test('sin llave de escritura no lee ni escribe nada', async () => {
    const signed = await authorize()
    vi.stubEnv('ODOO_WRITE_API_KEY', '')
    const { odoo, calls } = fakeOdoo({})
    const { writer, ops } = fakeWriter()
    await expect(odooSaveProduct({ reader: odoo, writer }, context().ctx, signed)).rejects.toThrow(
      'La escritura en Odoo está deshabilitada en este servidor (falta ODOO_WRITE_API_KEY).',
    )
    expect(calls).toEqual([])
    expect(ops).toEqual([])
  })
})

describe('alta', () => {
  test('crea en una sola llamada con nombre, ETM y clave SAT resuelta', async () => {
    const signed = await authorize()
    expect(signed.productos).toEqual([
      { codigo: 'ZZTEST144', descripcion: 'Producto de prueba del asistente', marca: 'PRUEBA', precio: 1 },
      { codigo: '7230', descripcion: 'Pinza de punta larga', marca: 'SURTEK', etm: '510099001', precio: 120, clave_sat: '27112100' },
    ])
    const { odoo, calls } = fakeOdoo(saveScript())
    const { writer, calls: writes, logs } = fakeWriter({ 'product.product.create': [[32300, 32301]] })

    const result = await odooSaveProduct({ reader: odoo, writer }, context().ctx, signed)

    expect(calls.map((c) => `${c.model}.${c.method}`)).toEqual(['product.product.search_read', 'product.unspsc.code.search_read'])
    expect(calls[0].payload).toEqual({
      domain: [
        '|', '|',
        ['name', '=ilike', ZZTEST_NAME],
        ['name', '=ilike', PINZA_NAME],
        ['default_code', 'ilike', '510099001'],
      ],
      fields: ['name', 'default_code'],
      limit: 62,
      order: 'id asc',
      // Archived ones too: a product that exists must never be created twice.
      context: { active_test: false },
    })
    expect(calls[1].payload).toEqual({
      domain: [['code', 'in', ['27112100']]],
      fields: ['code'],
      limit: 3,
      // An archived SAT key is still a real one: it must not come back as «no existe».
      context: { active_test: false },
    })

    expect(writes).toHaveLength(1)
    expect(writes[0]).toMatchObject({ model: 'product.product', method: 'create' })
    expect(writes[0].payload).toEqual({
      vals_list: [
        { name: ZZTEST_NAME, list_price: 1, type: 'consu', sale_ok: true },
        { name: PINZA_NAME, default_code: '510099001', list_price: 120, type: 'consu', sale_ok: true, unspsc_code_id: 900 },
      ],
    })
    expect(logs).toEqual([{ op: 'product.product.create', ids: [32300, 32301], actor: 'admin-1' }])
    expect(result).toEqual({
      creados: [
        { id: 32300, nombre: ZZTEST_NAME },
        { id: 32301, nombre: PINZA_NAME },
      ],
      ya_existian: [],
      sin_clave_sat: 1,
    })
  })

  test('los que ya existen no se duplican', async () => {
    const signed = await authorize()
    // Same name in other casing, and the ETM inside a comma list: both already there.
    const rows = [
      { id: 32300, name: 'zztest144 producto de prueba del asistente prueba', default_code: false, active: true },
      { id: 16971, name: '7230 Pinza vieja SURTEK', default_code: '510033153, 510099001', active: false },
    ]
    const { odoo, calls } = fakeOdoo(saveScript({ 'product.product.search_read': [rows] }))
    const { writer, attempts } = throwingWriter()
    const result = await odooSaveProduct({ reader: odoo, writer }, context().ctx, signed)
    expect(result).toEqual({
      creados: [],
      ya_existian: [
        { id: 32300, nombre: rows[0].name },
        { id: 16971, nombre: rows[1].name },
      ],
      sin_clave_sat: 0,
    })
    // Nothing to create: not even the SAT keys are looked up.
    expect(calls.map((c) => c.model)).toEqual(['product.product'])
    expect(attempts).toEqual([])

    // Only the missing one is created.
    const partial = fakeOdoo(saveScript({ 'product.product.search_read': [[rows[0]]] }))
    const { writer: w2, calls: writes } = fakeWriter({ 'product.product.create': [[32301]] })
    await expect(odooSaveProduct({ reader: partial.odoo, writer: w2 }, context().ctx, signed)).resolves.toEqual({
      creados: [{ id: 32301, nombre: PINZA_NAME }],
      ya_existian: [{ id: 32300, nombre: rows[0].name }],
      sin_clave_sat: 0,
    })
    expect((writes[0].payload.vals_list as { name: string }[]).map((v) => v.name)).toEqual([PINZA_NAME])
  })

  test('clave SAT inexistente o 01010101 → error antes de crear', async () => {
    const placeholder = await authorize([{ ...PINZA_LINE, clave_sat: SAT_PLACEHOLDER }])
    const first = fakeOdoo(saveScript())
    const { writer, ops } = fakeWriter()
    await expect(odooSaveProduct({ reader: first.odoo, writer }, context().ctx, placeholder)).rejects.toThrow(
      'La clave SAT 01010101 significa «no existe en el catálogo»: usa la clave real o quítala (se captura después en Odoo). No se creó nada.',
    )
    expect(first.calls.map((c) => c.model)).toEqual(['product.product'])

    const unknown = await authorize([{ ...PINZA_LINE, clave_sat: '99999999' }])
    const second = fakeOdoo(saveScript({ 'product.unspsc.code.search_read': [[]] }))
    await expect(odooSaveProduct({ reader: second.odoo, writer }, context().ctx, unknown)).rejects.toThrow(
      'La clave SAT 99999999 no existe en el catálogo del SAT de Odoo: corrígela o quítala y vuelve a pedir la vista previa. No se creó nada.',
    )
    expect(second.calls.map((c) => c.model)).toEqual(['product.product', 'product.unspsc.code'])
    expect(ops).toEqual([])
  })

  test('demasiadas coincidencias en Odoo → no crea nada', async () => {
    const signed = await authorize([ZZTEST_LINE])
    const many = Array.from({ length: 56 }, (_, i) => ({ id: 40000 + i, name: `Otro ${i}`, default_code: false, active: true }))
    const { odoo } = fakeOdoo(saveScript({ 'product.product.search_read': [many] }))
    const { writer, attempts } = throwingWriter()
    await expect(odooSaveProduct({ reader: odoo, writer }, context().ctx, signed)).rejects.toThrow(
      /^Hay demasiadas coincidencias en Odoo para estos productos: no se creó nada/,
    )
    expect(attempts).toEqual([])
  })

  test('timeout al crear → resultado desconocido; repetir el mismo clic los encuentra sin duplicar', async () => {
    const signed = await authorize([ZZTEST_LINE])
    const { writer } = fakeWriter({ 'product.product.create': [new OdooUncertainWriteError('product.product.create', 'products', 504)] })
    const failure = await odooSaveProduct({ reader: fakeOdoo(saveScript()).odoo, writer }, context().ctx, signed).catch((e: unknown) => e)
    expect(failure).toBeInstanceOf(OdooUncertainWriteError)
    expect((failure as Error).message).toMatch(/Repite el mismo clic: los productos que ya se hayan creado salen como existentes/)

    const landed = fakeOdoo(saveScript({ 'product.product.search_read': [[{ id: 32300, name: ZZTEST_NAME, default_code: false, active: true }]] }))
    const { writer: never, attempts } = throwingWriter()
    await expect(odooSaveProduct({ reader: landed.odoo, writer: never }, context().ctx, signed)).resolves.toEqual({
      creados: [],
      ya_existian: [{ id: 32300, nombre: ZZTEST_NAME }],
      sin_clave_sat: 0,
    })
    expect(attempts).toEqual([])
  })
})
