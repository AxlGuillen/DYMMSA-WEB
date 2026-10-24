/**
 * odoo_save_product (#144, ADR-040). The authorization comes from the real
 * preview; the real facade and write catalog run over fakes: nothing reaches Odoo nor Supabase.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { createMockSupabase } from '../helpers/supabase-mock'
import { fakeOdoo, fakeWriter, throwingWriter, type OdooScript } from '../helpers/fake-odoo'
import { odooPreviewQuotation, type QuotationLineInput, type QuotationPreview } from '@/lib/mcp/tools/odoo/quotations'
import { odooSaveProduct, SAT_PLACEHOLDER, type SaveProductInput } from '@/lib/mcp/tools/odoo/products-write'
import { splitResultMeta } from '@/lib/mcp/core/result'
import type { Db } from '@/lib/mcp/core/db'
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

/** What Odoo has in product.product and product.unspsc.code when the preview reads (#154). */
interface PreviewOdoo {
  products?: unknown[]
  satRows?: unknown[]
}

/** The real preview: what the view sends to odoo_save_product, plus the quotation key the model sees. */
async function previewKeys(
  lineas: QuotationLineInput[],
  ctx = context().ctx,
  odooHas: PreviewOdoo = {},
): Promise<{ input: SaveProductInput; clave: string; preview: QuotationPreview; autorizacion: string }> {
  const { odoo } = fakeOdoo({
    'res.partner.search_read': [[COMPANY]],
    'product.product.search_read': [odooHas.products ?? []],
    'sale.order.search_read': [[]],
    'product.unspsc.code.search_read': [odooHas.satRows ?? []],
  })
  const { writer, attempts } = throwingWriter()
  const { data, meta } = splitResultMeta(await odooPreviewQuotation({ reader: odoo, writer }, ctx, { cliente: '#1', lineas }))
  expect(attempts).toEqual([])
  const preview = data as QuotationPreview
  const autorizacion = meta?.[PRODUCTS_AUTHORIZATION_META]
  expect(autorizacion).toEqual(expect.any(String))
  expect(preview.clave).toEqual(expect.any(String))
  return {
    input: { productos: [...preview.productos_para_alta], autorizacion: autorizacion as string },
    clave: preview.clave as string,
    preview,
    autorizacion: autorizacion as string,
  }
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

/** product.unspsc.code as the preview's one suggestion search sees it (#154). */
const SAT_ROWS = [
  { id: 900, code: '31211507', name: 'Pinturas en aerosol' },
  { id: 901, code: '31211500', name: 'Pinturas' },
]
const AERO_LINE: QuotationLineInput = { codigo: 'ZZAERO', descripcion: 'Pintura en aerosol negro', cantidad: 6, precio: 56.03 }

function productRow(id: number, name: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    name,
    default_code: false,
    type: 'consu',
    is_storable: false,
    invoice_policy: 'delivery',
    sale_ok: true,
    active: true,
    list_price: 0,
    uom_id: [1, 'Unidades'],
    unspsc_code_id: false,
    ...overrides,
  }
}
const AEROSOL = productRow(16980, 'ZZAERO Pintura en aerosol negro URREA')
const MANGO = productRow(16971, '5467 Mango articulado cromado URREA')

describe('clave SAT elegida en la vista (#154)', () => {
  test('una clave que ofreció la vista previa pasa; dejarla vacía también', async () => {
    const { input, preview } = await previewKeys([AERO_LINE], undefined, { satRows: SAT_ROWS })
    expect(preview.productos_nuevos[0].sugerencias_sat.map((s) => s.clave)).toEqual(['31211507', '31211500'])

    const chosen = { ...input, productos: [{ ...input.productos[0], clave_sat: '31211500' }] }
    const { odoo } = fakeOdoo(saveScript({ 'product.unspsc.code.search_read': [[{ id: 901, code: '31211500' }]] }))
    const { writer, calls: writes } = fakeWriter({ 'product.product.create': [[32400]] })
    await expect(odooSaveProduct({ reader: odoo, writer }, context().ctx, chosen)).resolves.toMatchObject({ sin_clave_sat: 0 })
    expect((writes[0].payload.vals_list as { unspsc_code_id?: number }[])[0].unspsc_code_id).toBe(901)

    const none = fakeOdoo(saveScript())
    const { writer: w2, calls: noKey } = fakeWriter({ 'product.product.create': [[32401]] })
    await expect(odooSaveProduct({ reader: none.odoo, writer: w2 }, context().ctx, input)).resolves.toMatchObject({ sin_clave_sat: 1 })
    expect((noKey[0].payload.vals_list as Record<string, unknown>[])[0]).not.toHaveProperty('unspsc_code_id')
    // Without a key to write, the SAT catalog is not even read.
    expect(none.calls.map((c) => c.model)).toEqual(['product.product'])
  })

  test('una clave que no ofreció, inventada o 01010101 sin teclear no crea nada ni lee Odoo', async () => {
    const { input } = await previewKeys([AERO_LINE], undefined, { satRows: SAT_ROWS })
    for (const clave_sat of ['27112100', '99999999', SAT_PLACEHOLDER]) {
      const { odoo, calls } = fakeOdoo({})
      const { writer, ops } = fakeWriter()
      const forged = { ...input, productos: [{ ...input.productos[0], clave_sat }] }
      await expect(odooSaveProduct({ reader: odoo, writer }, context().ctx, forged), clave_sat).rejects.toThrow(PRODUCTS_CHANGED_MESSAGE)
      expect(calls, clave_sat).toEqual([])
      expect(ops, clave_sat).toEqual([])
    }
  })

  test('una clave tecleada por el administrador pasa solo si existe en el catálogo: mismos mensajes de hoy', async () => {
    const { input } = await previewKeys([AERO_LINE], undefined, { satRows: SAT_ROWS })
    const typed = (clave_sat: string) => ({ ...input, productos: [{ ...input.productos[0], clave_sat, clave_sat_tecleada: true }] })

    const exists = fakeOdoo(saveScript({ 'product.unspsc.code.search_read': [[{ id: 905, code: '27112100' }]] }))
    const { writer, calls: writes } = fakeWriter({ 'product.product.create': [[32402]] })
    await odooSaveProduct({ reader: exists.odoo, writer }, context().ctx, typed('27112100'))
    expect((writes[0].payload.vals_list as { unspsc_code_id?: number }[])[0].unspsc_code_id).toBe(905)

    const { writer: never, ops } = fakeWriter()
    const invented = fakeOdoo(saveScript({ 'product.unspsc.code.search_read': [[]] }))
    await expect(odooSaveProduct({ reader: invented.odoo, writer: never }, context().ctx, typed('99999999'))).rejects.toThrow(
      'La clave SAT 99999999 no existe en el catálogo del SAT de Odoo: corrígela o quítala y vuelve a pedir la vista previa. No se creó nada.',
    )
    await expect(
      odooSaveProduct({ reader: fakeOdoo(saveScript()).odoo, writer: never }, context().ctx, typed(SAT_PLACEHOLDER)),
    ).rejects.toThrow(
      'La clave SAT 01010101 significa «no existe en el catálogo»: usa la clave real o quítala (se captura después en Odoo). No se creó nada.',
    )
    expect(ops).toEqual([])
  })
})

describe('asignar la clave SAT a productos que ya existen (#154)', () => {
  const LINES: QuotationLineInput[] = [
    { producto_id: 16980, cantidad: 6, precio: 56.03 },
    { producto_id: 16971, cantidad: 1, precio: 950 },
  ]
  const keyed = () => previewKeys(LINES, undefined, { products: [AEROSOL, MANGO], satRows: SAT_ROWS })
  const reread = (overrides: Record<number, unknown> = {}) => [
    { id: 16971, name: MANGO.name, unspsc_code_id: overrides[16971] ?? false },
    { id: 16980, name: AEROSOL.name, unspsc_code_id: overrides[16980] ?? false },
  ]
  const assign = (asignar: NonNullable<SaveProductInput['asignar']>, autorizacion: string): SaveProductInput => ({ asignar, autorizacion })

  test('la vista previa marca los existentes sin clave con sus sugerencias', async () => {
    const { preview } = await keyed()
    expect(preview.sin_clave_sat.map((p) => [p.producto_id, p.lineas, p.sugerencias_sat.map((s) => s.clave)])).toEqual([
      [16980, [1], ['31211507', '31211500']],
      [16971, [2], []],
    ])
  })

  test('escribe solo unspsc_code_id, una escritura por clave: la ofrecida y la tecleada', async () => {
    const { autorizacion } = await keyed()
    const { odoo, calls } = fakeOdoo({
      'product.product.search_read': [reread()],
      'product.unspsc.code.search_read': [[{ id: 900, code: '31211507' }]],
    })
    const { writer, calls: writes, logs } = fakeWriter()
    const input = assign(
      [
        { producto_id: 16980, clave_sat: '31211507' },
        { producto_id: 16971, clave_sat: '31211507', clave_sat_tecleada: true },
      ],
      autorizacion,
    )
    await expect(odooSaveProduct({ reader: odoo, writer }, context().ctx, input)).resolves.toEqual({
      asignados: [
        { id: 16980, nombre: AEROSOL.name, clave_sat: '31211507' },
        { id: 16971, nombre: MANGO.name, clave_sat: '31211507' },
      ],
      ya_tenian: [],
    })
    expect(calls.map((c) => `${c.model}.${c.method}`)).toEqual(['product.product.search_read', 'product.unspsc.code.search_read'])
    expect(calls[0].payload).toEqual({
      domain: [['id', 'in', [16971, 16980]]],
      fields: ['name', 'unspsc_code_id'],
      limit: 2,
      context: { active_test: false },
    })
    expect(writes.map(({ model, method, payload }) => ({ model, method, payload }))).toEqual([
      { model: 'product.product', method: 'write', payload: { ids: [16980, 16971], vals: { unspsc_code_id: 900 } } },
    ])
    expect(logs).toEqual([{ op: 'product.product.write', ids: [16980, 16971], actor: 'admin-1' }])
  })

  test('una clave que alguien ya capturó en Odoo no se pisa', async () => {
    const { autorizacion } = await keyed()
    const { odoo, calls } = fakeOdoo({ 'product.product.search_read': [reread({ 16980: [70, '27111700 Llaves'] })] })
    const { writer, attempts } = throwingWriter()
    await expect(
      odooSaveProduct({ reader: odoo, writer }, context().ctx, assign([{ producto_id: 16980, clave_sat: '31211507' }], autorizacion)),
    ).resolves.toEqual({ asignados: [], ya_tenian: [{ id: 16980, nombre: AEROSOL.name, clave_sat: '27111700 Llaves' }] })
    // Nothing to write: not even the SAT catalog is read.
    expect(calls.map((c) => c.model)).toEqual(['product.product'])
    expect(attempts).toEqual([])

    // A key Odoo sends without its name still counts, and never shows as "#412" (review PR #167).
    const unnamed = fakeOdoo({ 'product.product.search_read': [reread({ 16980: [412, false] })] })
    await expect(
      odooSaveProduct({ reader: unnamed.odoo, writer }, context().ctx, assign([{ producto_id: 16980, clave_sat: '31211507' }], autorizacion)),
    ).resolves.toEqual({ asignados: [], ya_tenian: [{ id: 16980, nombre: AEROSOL.name, clave_sat: null }] })
    expect(attempts).toEqual([])
  })

  test('un producto que la vista previa no marcó, una clave no ofrecida sin teclear o un producto repetido no escriben ni leen', async () => {
    const { autorizacion } = await keyed()
    const cases: [string, NonNullable<SaveProductInput['asignar']>, string][] = [
      ['no marcado', [{ producto_id: 30888, clave_sat: '31211507' }], PRODUCTS_CHANGED_MESSAGE],
      ['no ofrecida', [{ producto_id: 16971, clave_sat: '31211507' }], PRODUCTS_CHANGED_MESSAGE],
      ['01010101 sin teclear', [{ producto_id: 16980, clave_sat: SAT_PLACEHOLDER }], PRODUCTS_CHANGED_MESSAGE],
      [
        'repetido',
        [
          { producto_id: 16980, clave_sat: '31211507' },
          { producto_id: 16980, clave_sat: '31211500' },
        ],
        'El producto #16980 viene dos veces. No se asignó ninguna clave.',
      ],
    ]
    for (const [label, asignar, message] of cases) {
      const { odoo, calls } = fakeOdoo({})
      const { writer, ops } = fakeWriter()
      await expect(odooSaveProduct({ reader: odoo, writer }, context().ctx, assign(asignar, autorizacion)), label).rejects.toThrow(message)
      expect(calls, label).toEqual([])
      expect(ops, label).toEqual([])
    }
  })

  test('tecleada inexistente o 01010101: los mensajes de hoy, con «No se asignó ninguna clave»', async () => {
    const { autorizacion } = await keyed()
    const { writer, ops } = fakeWriter()
    const missing = fakeOdoo({ 'product.product.search_read': [reread()], 'product.unspsc.code.search_read': [[]] })
    await expect(
      odooSaveProduct(
        { reader: missing.odoo, writer },
        context().ctx,
        assign([{ producto_id: 16971, clave_sat: '99999999', clave_sat_tecleada: true }], autorizacion),
      ),
    ).rejects.toThrow(
      'La clave SAT 99999999 no existe en el catálogo del SAT de Odoo: corrígela o quítala y vuelve a pedir la vista previa. No se asignó ninguna clave.',
    )
    const placeholder = fakeOdoo({ 'product.product.search_read': [reread()] })
    await expect(
      odooSaveProduct(
        { reader: placeholder.odoo, writer },
        context().ctx,
        assign([{ producto_id: 16971, clave_sat: SAT_PLACEHOLDER, clave_sat_tecleada: true }], autorizacion),
      ),
    ).rejects.toThrow(
      'La clave SAT 01010101 significa «no existe en el catálogo»: usa la clave real o quítala (se captura después en Odoo). No se asignó ninguna clave.',
    )
    expect(ops).toEqual([])
  })

  test('alta y asignar a la vez, o ninguno: error antes de Odoo; un member no llega', async () => {
    const { autorizacion, input } = await keyed()
    const bad = [
      { productos: [{ codigo: 'ZZ', descripcion: 'Z', precio: 1 }], asignar: [{ producto_id: 16980, clave_sat: '31211507' }], autorizacion },
      { autorizacion },
    ]
    for (const raw of bad) {
      const { odoo, calls } = fakeOdoo({})
      const { writer, ops } = fakeWriter()
      await expect(odooSaveProduct({ reader: odoo, writer }, context().ctx, raw as SaveProductInput)).rejects.toThrow(
        'Manda productos (alta) o asignar (clave SAT de productos que ya existen), no los dos. No se escribió nada.',
      )
      expect(calls).toEqual([])
      expect(ops).toEqual([])
    }
    // This preview had nothing to create: its alta list is empty, never a pass for products.
    expect(input.productos).toEqual([])
    const { odoo, calls } = fakeOdoo({})
    const { writer, attempts } = throwingWriter()
    await expect(
      odooSaveProduct(
        { reader: odoo, writer },
        context({ role: 'member' }).ctx,
        assign([{ producto_id: 16980, clave_sat: '31211507' }], autorizacion),
      ),
    ).rejects.toThrow(ADMIN_ONLY_MESSAGE)
    expect(calls).toEqual([])
    expect(attempts).toEqual([])
  })

  test('escritura incierta: repetir el mismo clic encuentra las ya asignadas y no reescribe', async () => {
    const { autorizacion } = await keyed()
    const click = assign([{ producto_id: 16980, clave_sat: '31211507' }], autorizacion)
    const { writer } = fakeWriter({ 'product.product.write': [new OdooUncertainWriteError('product.product.write', 'sat-keys', 504)] })
    const first = fakeOdoo({ 'product.product.search_read': [reread()], 'product.unspsc.code.search_read': [[{ id: 900, code: '31211507' }]] })
    const failure = await odooSaveProduct({ reader: first.odoo, writer }, context().ctx, click).catch((e: unknown) => e)
    expect(failure).toBeInstanceOf(OdooUncertainWriteError)
    expect((failure as Error).message).toMatch(/Repite el mismo clic: los productos que ya tengan su clave SAT salen como ya asignados/)

    const landed = fakeOdoo({ 'product.product.search_read': [reread({ 16980: [900, '31211507 Pinturas en aerosol'] })] })
    const { writer: never, attempts } = throwingWriter()
    await expect(odooSaveProduct({ reader: landed.odoo, writer: never }, context().ctx, click)).resolves.toEqual({
      asignados: [],
      ya_tenian: [{ id: 16980, nombre: AEROSOL.name, clave_sat: '31211507 Pinturas en aerosol' }],
    })
    expect(attempts).toEqual([])
  })
})
