/**
 * odoo_preview_quotation / odoo_save_quotation (#144, ADR-040), not registered yet. The real
 * keys, the real facade and write catalog run over fakes: nothing reaches Odoo nor Supabase.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { createHash } from 'node:crypto'
import { createMockSupabase } from '../helpers/supabase-mock'
import { fakeOdoo, fakeWriter, throwingWriter, type OdooScript } from '../helpers/fake-odoo'
import {
  odooPreviewQuotation,
  odooSaveQuotation,
  type PreviewQuotationInput,
  type QuotationPreview,
  type SaveQuotationInput,
} from '@/lib/mcp/tools/odoo/quotations'
import { requireLiveAdmin, splitResultMeta, type Db } from '@/lib/mcp/shared'
import { OdooError, OdooUncertainWriteError } from '@/lib/odoo/client'
import {
  PREVIEW_CHANGED_MESSAGE,
  PREVIEW_EXPIRED_MESSAGE,
  PREVIEW_KEY_INVALID_MESSAGE,
  PREVIEW_KEY_MISSING_MESSAGE,
  PREVIEW_KEY_OTHER_ADMIN_MESSAGE,
  PRODUCTS_AUTHORIZATION_META,
  quotationContentHash,
  verifyProductsAuthorization,
} from '@/lib/odoo/preview-token'
import { ADMIN_ONLY_MESSAGE } from '@/lib/odoo/write-guard'
import type { McpRole } from '@/lib/mcp/manifest'
import { MAX_LINE_COMMANDS } from '@/lib/odoo/write-catalog'
import { MAX_EDIT_LINES } from '@/lib/mcp/tools/odoo/resolve'
import { MAX_QUOTATION_LINES } from '@/lib/mcp/tools/odoo/quotations'

// 17:00 in Morelia (UTC-6).
const NOW = Date.UTC(2026, 9, 17, 23, 0)
const STAMP = '2026-10-17 17:00'
const WRITE_KEY = 'write-key-0123456789abcdef'

beforeEach(() => {
  vi.stubEnv('ODOO_URL', 'https://odoo.test')
  vi.stubEnv('ODOO_WRITE_API_KEY', WRITE_KEY)
  vi.stubEnv('ODOO_DB', '')
  // One clock for the proof, the keys, the grants and the writer (#144).
  vi.useFakeTimers({ toFake: ['Date'], now: NOW })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

function context(opts: { role?: McpRole; profileRole?: string; userId?: string; name?: string } = {}) {
  const client = createMockSupabase({
    responses: { profiles: { data: { role: opts.profileRole ?? 'admin', display_name: opts.name ?? 'Ana Admin' } } },
  })
  return { client, ctx: { db: client as unknown as Db, userId: opts.userId ?? 'admin-1', role: opts.role ?? 'admin' } }
}

const k10Of = (clave: string) => createHash('sha256').update(clave, 'utf8').digest('hex').slice(0, 10)

const COMPANY = { id: 1, name: 'DISTRIBUCIONES Y MANUFACTURAS DE MICHOACAN', vat: 'DMM020826363', active: true }
const GE = { id: 17, name: 'GE POWER SERVICES MEXICO', vat: 'GPS970101AB1', active: true }

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
    unspsc_code_id: [70, '27111700 Llaves'],
    ...overrides,
  }
}

const REPINTADO = productRow(30888, 'Re pintado', {
  type: 'service',
  invoice_policy: 'order',
  uom_id: [8, 'm'],
  unspsc_code_id: [53100, '73181104 Painting services'],
})
const MANGO = productRow(16971, '5467 Mango articulado cromado URREA', { default_code: '510033153, 510022171' })
const ZZTEST = productRow(32300, 'ZZTEST144 Producto de prueba del asistente PRUEBA', { unspsc_code_id: false })

const NOTE_LINE = { nota: 'PRUEBA #144 — no procesar' }

const CREATE_INPUT: PreviewQuotationInput = {
  cliente: '#1',
  lineas: [NOTE_LINE, { producto_id: 30888, cantidad: 1, precio: 1 }],
}

const ORIGINAL_NOTE = '<p>Creada por el asistente (MCP) a petición de Ana Admin · 2026-10-17 16:40 · clave 0123456789 · contenido abcdef0123</p>'

function saleRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 912,
    name: 'S00912',
    state: 'draft',
    locked: false,
    write_date: '2026-10-17 22:47:43',
    partner_id: [1, COMPANY.name],
    amount_untaxed: 2,
    amount_tax: 0.32,
    amount_total: 2.32,
    currency_id: [33, 'MXN'],
    date_order: '2026-10-17 22:47:43',
    validity_date: '2026-11-16',
    internal_note: ORIGINAL_NOTE,
    ...overrides,
  }
}

const SALE_LINES = [
  { id: 7001, display_type: 'line_note', name: 'PRUEBA #144 — no procesar', product_id: false, product_uom_qty: 0, price_unit: 0, discount: 0, sequence: 10, price_subtotal: 0 },
  { id: 7002, display_type: false, name: 'Re pintado', product_id: [30888, 'Re pintado'], product_uom_qty: 1, price_unit: 1, discount: 0, sequence: 20, price_subtotal: 1 },
  { id: 7003, display_type: false, name: ZZTEST.name, product_id: [32300, ZZTEST.name], product_uom_qty: 1, price_unit: 1, discount: 0, sequence: 30, price_subtotal: 1 },
]

const EDIT_INPUT: PreviewQuotationInput = {
  folio: 'S00912',
  lineas: [
    { linea_id: 7001, nota: 'PRUEBA #144 — no procesar' },
    { linea_id: 7002, producto_id: 30888, cantidad: 2, precio: 1 },
  ],
}

async function preview(input: PreviewQuotationInput, script: OdooScript, ctx = context().ctx) {
  const { odoo, calls } = fakeOdoo(script)
  const { writer, attempts } = throwingWriter()
  const raw = await odooPreviewQuotation({ reader: odoo, writer }, ctx, input)
  const { data, meta } = splitResultMeta(raw)
  expect(attempts).toEqual([])
  return { data: data as QuotationPreview, meta, calls }
}

const createPreviewScript = (): OdooScript => ({
  'res.partner.search_read': [[COMPANY]],
  'product.product.search_read': [[REPINTADO]],
  'sale.order.search_read': [[]],
})

async function createKey(input: PreviewQuotationInput = CREATE_INPUT): Promise<string> {
  const { data } = await preview(input, createPreviewScript())
  expect(data.clave).toEqual(expect.any(String))
  return data.clave as string
}

const createSaveScript = (overrides: OdooScript = {}): OdooScript => ({
  'sale.order.search_read': [[], [saleRow()]],
  'res.partner.search_read': [[COMPANY]],
  'product.product.search_read': [[REPINTADO]],
  'sale.order.line.search_read': [[{ id: 7002, product_id: [30888, 'Re pintado'], price_unit: 1, qty_to_invoice: 0 }]],
  ...overrides,
})

describe('rol y vista previa', () => {
  test('un member o un admin degradado no llega a Odoo: cero llamadas', async () => {
    for (const who of [context({ role: 'member' }), context({ profileRole: 'member' })]) {
      const { odoo, calls } = fakeOdoo({})
      const { writer, attempts } = throwingWriter()
      await expect(odooPreviewQuotation({ reader: odoo, writer }, who.ctx, CREATE_INPUT)).rejects.toThrow(ADMIN_ONLY_MESSAGE)
      await expect(odooSaveQuotation({ reader: odoo, writer }, who.ctx, { ...CREATE_INPUT, clave: 'x.y' })).rejects.toThrow(
        ADMIN_ONLY_MESSAGE,
      )
      expect(calls).toEqual([])
      expect(attempts).toEqual([])
    }
  })

  test('la vista previa solo lee y entrega la clave', async () => {
    const { data, meta, calls } = await preview(CREATE_INPUT, createPreviewScript())
    expect(calls.map((c) => `${c.model}.${c.method}`)).toEqual([
      'res.partner.search_read',
      'product.product.search_read',
      'sale.order.search_read',
    ])
    expect(data).toMatchObject({
      modo: 'crear',
      cliente: { id: 1, nombre: COMPANY.name, rfc: 'DMM020826363', es_la_empresa: true },
      cotizacion: null,
      lineas: [
        { n: 1, tipo: 'nota', texto: 'PRUEBA #144 — no procesar' },
        { n: 2, tipo: 'producto', estado: 'existe', producto: { id: 30888, clase: 'servicio', factura_por: 'pedido' }, subtotal: 1 },
      ],
      productos_nuevos: [],
      productos_para_alta: [],
      subtotal: 1,
      moneda: 'MXN',
      bloqueos: [],
      puede_guardar: true,
      vence: new Date(NOW + 30 * 60_000).toISOString(),
    })
    expect(data.avisos).toEqual([expect.stringContaining('contacto de la propia empresa')])
    expect(data.al_confirmar).toBe('1 línea se podrá facturar en cuanto se confirme; la fecha de la orden pasará a hoy. No se manda correo al cliente.')
    expect(data.siguiente_paso).toMatch(/^Nada se ha guardado\. .*odoo_save_quotation con los mismos datos y la clave/)
    // Nothing to create: no products authorization.
    expect(meta).toBeNull()
  })

  test('sin llave de escritura la vista previa se pinta pero no entrega clave', async () => {
    vi.stubEnv('ODOO_WRITE_API_KEY', '')
    const { data } = await preview(CREATE_INPUT, createPreviewScript())
    expect(data).toMatchObject({ puede_guardar: false, clave: null, vence: null })
    expect(data.bloqueos).toEqual([expect.stringContaining('falta ODOO_WRITE_API_KEY')])
  })

  test('cliente inexistente: error que pide darlo de alta en Odoo', async () => {
    const { odoo, calls } = fakeOdoo({ 'res.partner.search_read': [[], []] })
    const { writer } = throwingWriter()
    await expect(
      odooPreviewQuotation({ reader: odoo, writer }, context().ctx, { ...CREATE_INPUT, cliente: 'DYMMSA' }),
    ).rejects.toThrow('No hay ningún cliente en Odoo que coincida con "DYMMSA": créalo en Odoo (el asistente no da de alta clientes)')
    expect(calls).toHaveLength(2)
    // The second look includes archived contacts.
    expect(calls[1].payload.context).toEqual({ active_test: false })

    const archived = fakeOdoo({ 'res.partner.search_read': [[], [{ ...GE, active: false }]] })
    await expect(
      odooPreviewQuotation({ reader: archived.odoo, writer }, context().ctx, { ...CREATE_INPUT, cliente: 'GE POWER' }),
    ).rejects.toThrow(/GE POWER SERVICES MEXICO \(#17\) está archivado en Odoo: reactívalo ahí/)
  })

  test('cliente ambiguo (GE VERNOVA): lista (#id), nada escrito', async () => {
    const vernova = [
      { id: 52, name: 'GE VERNOVA GLOBAL SERVICES GMBH', vat: false, active: true },
      { id: 74, name: 'GE VERNOVA MEXICO', vat: false, active: true },
      { id: 67, name: 'GE VERNOVA TECHNOLOGY SOLUTIONS MEXICO', vat: false, active: true },
    ]
    const { odoo, calls } = fakeOdoo({ 'res.partner.search_read': [vernova] })
    const { writer, attempts } = throwingWriter()
    await expect(
      odooPreviewQuotation({ reader: odoo, writer }, context().ctx, { ...CREATE_INPUT, cliente: 'GE VERNOVA' }),
    ).rejects.toThrow(
      'Hay 3 coincidencias (GE VERNOVA GLOBAL SERVICES GMBH (#52), GE VERNOVA MEXICO (#74), GE VERNOVA TECHNOLOGY SOLUTIONS MEXICO (#67))',
    )
    expect(calls).toHaveLength(1)
    expect(attempts).toEqual([])
  })

  test('encuentra clientes con customer_rank 0 y por RFC', async () => {
    const byRfc = await preview({ ...CREATE_INPUT, cliente: 'dmm020826363' }, createPreviewScript())
    // Odoo copies vat to child contacts and addresses: only the commercial entity is searched.
    expect(byRfc.calls[0].payload.domain).toEqual([
      ['vat', '=', 'DMM020826363'],
      '|', ['is_company', '=', true], ['parent_id', '=', false],
    ])
    expect(byRfc.data.cliente).toMatchObject({ id: 1, es_la_empresa: true })

    const byName = await preview(
      { ...CREATE_INPUT, cliente: 'ge power' },
      { ...createPreviewScript(), 'res.partner.search_read': [[GE]] },
    )
    expect(byName.calls[0].payload.domain).toEqual([['name', 'ilike', 'ge power']])
    expect(byName.data.cliente).toMatchObject({ id: 17, es_la_empresa: false })
    for (const { calls } of [byRfc, byName]) {
      expect(JSON.stringify(calls[0].payload)).not.toContain('customer_rank')
    }

    // An exact name wins over partial matches; a % in the name is literal.
    const exact = await preview(
      { ...CREATE_INPUT, cliente: 'GE POWER SERVICES MEXICO' },
      { ...createPreviewScript(), 'res.partner.search_read': [[GE, { ...GE, id: 18, name: 'GE POWER SERVICES MEXICO SUR' }]] },
    )
    expect(exact.data.cliente.id).toBe(17)
    const literal = await preview({ ...CREATE_INPUT, cliente: '100%_TALLER' }, { ...createPreviewScript(), 'res.partner.search_read': [[GE]] })
    expect(literal.calls[0].payload.domain).toEqual([['name', 'ilike', '100\\%\\_TALLER']])
  })

  test('por RFC una dirección sin nombre no tumba la búsqueda: queda la empresa', async () => {
    const address = { id: 81, name: false, vat: GE.vat, active: true }
    const { data } = await preview(
      { ...CREATE_INPUT, cliente: GE.vat },
      { ...createPreviewScript(), 'res.partner.search_read': [[GE, address]] },
    )
    expect(data.cliente).toMatchObject({ id: 17, nombre: GE.name, rfc: GE.vat })
  })

  test('todos los productos en UNA búsqueda', async () => {
    const lineas = [
      { producto_id: 30888, cantidad: 1, precio: 1 },
      { codigo: '5467', marca: 'URREA', cantidad: 3, precio: 950.98 },
      { etm: '510022171', cantidad: 1, precio: 950.98 },
      { descripcion: 'Suministro', cantidad: 1, precio: 10 },
    ]
    const { calls, data } = await preview(
      { cliente: '#1', lineas },
      { ...createPreviewScript(), 'product.product.search_read': [[MANGO, REPINTADO, productRow(50, 'Suministro')]] },
    )
    const searches = calls.filter((c) => c.model === 'product.product')
    expect(searches).toHaveLength(1)
    expect(searches[0].payload).toMatchObject({
      domain: [
        '|', '|', '|',
        ['id', 'in', [30888]],
        ['name', '=ilike', '5467 %'],
        ['default_code', 'ilike', '510022171'],
        ['name', '=ilike', 'Suministro'],
      ],
      context: { active_test: false },
      limit: 74,
    })
    expect(data.lineas.map((l) => l.producto?.id)).toEqual([30888, 16971, 16971, 50])
    expect(data.bloqueos).toEqual([])
  })

  test('producto ambiguo, archivado o faltante bloquea guardar', async () => {
    const lineas = [
      { descripcion: 'Suministro', cantidad: 1, precio: 10 },
      { codigo: '9001', cantidad: 1, precio: 10 },
      { producto_id: 404, cantidad: 1, precio: 10 },
      { codigo: '7230', marca: 'SURTEK', cantidad: 1, precio: 120 },
    ]
    const rows = [productRow(50, 'Suministro'), productRow(51, 'Suministro'), productRow(40, '9001 Llave vieja URREA', { active: false })]
    const { data, meta } = await preview({ cliente: '#1', lineas }, { ...createPreviewScript(), 'product.product.search_read': [rows] })
    expect(data.bloqueos).toEqual([
      'Línea 1: 2 productos se llaman "Suministro": elige uno (producto_id).',
      'Línea 2: «9001 Llave vieja URREA» (#40) está archivado: reactívalo en Odoo.',
      'Línea 3: el producto #404 no existe en Odoo.',
      'Línea 4: el producto no existe en Odoo; para darlo de alta hacen falta su código y su descripción.',
    ])
    expect(data.lineas.map((l) => l.estado)).toEqual(['ambiguo', 'bloqueado', 'bloqueado', 'nuevo'])
    expect(data).toMatchObject({ puede_guardar: false, clave: null })
    expect(data.siguiente_paso).toMatch(/Corrige lo que dicen los bloqueos/)
    expect(meta).toBeNull()
  })

  test('avisa de una cotización igual creada hace poco', async () => {
    const h10 = quotationContentHash(CREATE_INPUT).slice(0, 10)
    const twin = { id: 912, name: 'S00912', internal_note: `<p>Creada … · clave 0123456789 · contenido ${h10}</p>`, create_date: '2026-10-17 22:48:00' }
    const other = { id: 913, name: 'S00913', internal_note: '<p>… contenido ffffffffff</p>', create_date: '2026-10-17 22:50:00' }
    const { data, calls } = await preview(CREATE_INPUT, { ...createPreviewScript(), 'sale.order.search_read': [[other, twin]] })
    expect(data.avisos[0]).toBe('Ya creaste una igual hace 12 min: S00912. Si no quieres otra, no la guardes.')
    // A warning, not a block: another identical quote is allowed with this new key.
    expect(data.puede_guardar).toBe(true)
    const lookup = calls.find((c) => c.model === 'sale.order')
    expect(lookup?.payload.domain).toEqual([
      ['partner_id', '=', 1],
      ['origin', '=ilike', 'Asistente DYMMSA · %'],
      ['create_date', '>=', '2026-10-17 17:00:00'],
      ['state', '!=', 'cancel'],
    ])
  })

  test('productos_para_alta no trae null ni campos de pantalla', async () => {
    const input: PreviewQuotationInput = {
      cliente: '#1',
      lineas: [
        NOTE_LINE,
        { producto_id: 30888, cantidad: 1, precio: 1 },
        { codigo: 'ZZTEST144', descripcion: 'Producto de prueba del asistente', marca: 'PRUEBA', cantidad: 1, precio: 1 },
      ],
    }
    const { data, meta } = await preview(input, createPreviewScript())
    expect(data.productos_para_alta).toEqual([
      { codigo: 'ZZTEST144', descripcion: 'Producto de prueba del asistente', marca: 'PRUEBA', precio: 1 },
    ])
    expect(data.productos_nuevos).toEqual([
      {
        codigo: 'ZZTEST144',
        descripcion: 'Producto de prueba del asistente',
        marca: 'PRUEBA',
        etm: null,
        precio: 1,
        clave_sat: null,
        nombre_en_odoo: 'ZZTEST144 Producto de prueba del asistente PRUEBA',
      },
    ])
    expect(data.lineas[2]).toMatchObject({ estado: 'nuevo', propuesto: { nombre: 'ZZTEST144 Producto de prueba del asistente PRUEBA' } })
    expect(data.avisos).toContain('Línea 3 sin clave SAT: no podrá timbrarse hasta capturarla en Odoo.')
    expect(data.siguiente_paso).toMatch(/solo se dan de alta con el botón de la vista/)

    // The authorization signs exactly productos_para_alta, and only travels in _meta.
    const autorizacion = meta?.[PRODUCTS_AUTHORIZATION_META]
    expect(autorizacion).toEqual(expect.any(String))
    const proof = await requireLiveAdmin(context().ctx)
    expect(() => verifyProductsAuthorization(proof, autorizacion, data.productos_para_alta)).not.toThrow()
    expect(JSON.stringify(data)).not.toContain(String(autorizacion))
  })
})

describe('clave', () => {
  test('guardar sin clave, con clave alterada, de otro usuario, de otro modo o vencida no escribe', async () => {
    const clave = await createKey()
    const [payload, signature] = clave.split('.')
    const flipped = `${payload}.${signature.startsWith('A') ? 'B' : 'A'}${signature.slice(1)}`
    const cases: [string, SaveQuotationInput, ReturnType<typeof context>, string | RegExp][] = [
      ['sin clave', { ...CREATE_INPUT, clave: '  ' }, context(), PREVIEW_KEY_MISSING_MESSAGE],
      ['alterada', { ...CREATE_INPUT, clave: flipped }, context(), PREVIEW_KEY_INVALID_MESSAGE],
      ['de otro usuario', { ...CREATE_INPUT, clave }, context({ userId: 'admin-2' }), PREVIEW_KEY_OTHER_ADMIN_MESSAGE],
      ['otro contenido', { ...CREATE_INPUT, lineas: [NOTE_LINE], clave }, context(), PREVIEW_CHANGED_MESSAGE],
      ['otro modo', { folio: 'S00912', lineas: CREATE_INPUT.lineas, clave }, context(), /no para editar la cotización/],
    ]
    for (const [label, input, who, message] of cases) {
      const { odoo, calls } = fakeOdoo({})
      const { writer, ops } = fakeWriter()
      await expect(odooSaveQuotation({ reader: odoo, writer }, who.ctx, input), label).rejects.toThrow(message)
      // The key is checked before a single read.
      expect(calls, label).toEqual([])
      expect(ops, label).toEqual([])
    }

    vi.setSystemTime(NOW + 31 * 60_000)
    const { odoo, calls } = fakeOdoo({ 'sale.order.search_read': [[]] })
    const { writer, ops } = fakeWriter()
    await expect(odooSaveQuotation({ reader: odoo, writer }, context().ctx, { ...CREATE_INPUT, clave })).rejects.toThrow(
      PREVIEW_EXPIRED_MESSAGE,
    )
    // Only the "ya estaba" lookup ran.
    expect(calls.map((c) => `${c.model}.${c.method}`)).toEqual(['sale.order.search_read'])
    expect(ops).toEqual([])
  })

  test('sin llave de escritura guardar no lee ni escribe nada', async () => {
    const clave = await createKey()
    vi.stubEnv('ODOO_WRITE_API_KEY', '')
    const { odoo, calls } = fakeOdoo({})
    const { writer, ops } = fakeWriter()
    await expect(odooSaveQuotation({ reader: odoo, writer }, context().ctx, { ...CREATE_INPUT, clave })).rejects.toThrow(
      'La escritura en Odoo está deshabilitada en este servidor (falta ODOO_WRITE_API_KEY).',
    )
    expect(calls).toEqual([])
    expect(ops).toEqual([])
  })
})

describe('crear', () => {
  test('crea con origin marcador y rastro del administrador, sin contexto de correo', async () => {
    const clave = await createKey()
    const k10 = k10Of(clave)
    const h10 = quotationContentHash(CREATE_INPUT).slice(0, 10)
    const { odoo, calls } = fakeOdoo(createSaveScript())
    const { writer, calls: writes, logs } = fakeWriter({ 'sale.order.create': [[912]] })

    const result = await odooSaveQuotation({ reader: odoo, writer }, context().ctx, { ...CREATE_INPUT, clave })

    expect(writes).toHaveLength(1)
    expect(writes[0]).toMatchObject({ model: 'sale.order', method: 'create' })
    expect(writes[0].payload).toEqual({
      vals_list: [
        {
          partner_id: 1,
          origin: `Asistente DYMMSA · ${k10}`,
          internal_note: `<p>Creada por el asistente (MCP) a petición de Ana Admin · ${STAMP} · clave ${k10} · contenido ${h10}</p>`,
          order_line: [
            [0, 0, { display_type: 'line_note', name: 'PRUEBA #144 — no procesar', sequence: 10 }],
            [0, 0, { product_id: 30888, product_uom_qty: 1, price_unit: 1, discount: 0, sequence: 20 }],
          ],
        },
      ],
    })
    expect(writes[0].payload).not.toHaveProperty('context')
    expect(logs).toEqual([{ op: 'sale.order.create', ids: [912], actor: 'admin-1' }])
    // The idempotency lookup ran first, before any write.
    expect(calls[0].payload.domain).toEqual([['origin', '=', `Asistente DYMMSA · ${k10}`]])
    expect(result).toMatchObject({
      cotizacion: { folio: 'S00912', id: 912, estado: 'borrador', subtotal: 2, iva: 0.32, total: 2.32, moneda: 'MXN' },
    })
    expect(result).not.toHaveProperty('ya_existia')
    expect(result).not.toHaveProperty('precios_distintos')
    expect(result.siguiente_paso).toMatch(/^Quedó como cotización en BORRADOR \(S00912\)/)
  })

  test('un precio que Odoo guardó distinto sale en precios_distintos', async () => {
    const clave = await createKey()
    const { odoo } = fakeOdoo(
      createSaveScript({ 'sale.order.line.search_read': [[{ id: 7002, product_id: [30888, 'Re pintado'], price_unit: 1.5, qty_to_invoice: 0 }]] }),
    )
    const { writer } = fakeWriter({ 'sale.order.create': [[912]] })
    const result = await odooSaveQuotation({ reader: odoo, writer }, context().ctx, { ...CREATE_INPUT, clave })
    expect(result.precios_distintos).toEqual([{ linea: 2, pedido: 1, en_odoo: 1.5 }])
  })

  test('un reintento con la misma clave no duplica', async () => {
    const clave = await createKey()
    const first = fakeWriter({ 'sale.order.create': [[912]] })
    await odooSaveQuotation({ reader: fakeOdoo(createSaveScript()).odoo, writer: first.writer }, context().ctx, { ...CREATE_INPUT, clave })

    const { odoo, calls } = fakeOdoo({ 'sale.order.search_read': [[saleRow()]] })
    const { writer, attempts } = throwingWriter()
    const retry = await odooSaveQuotation({ reader: odoo, writer }, context().ctx, { ...CREATE_INPUT, clave })

    expect(retry).toMatchObject({ ya_existia: true, cotizacion: { folio: 'S00912' } })
    expect(retry.siguiente_paso).toBe('Ya estaba creada con esta clave (S00912): no escribí otra.')
    expect(calls).toHaveLength(1)
    // The same marker that the first save wrote.
    const sentOrigin = (first.calls[0].payload.vals_list as { origin: string }[])[0].origin
    expect(calls[0].payload.domain).toEqual([['origin', '=', sentOrigin]])
    expect(attempts).toEqual([])
  })

  test('una cotización cancelada con esa clave pide otra vista previa', async () => {
    const clave = await createKey()
    const { odoo } = fakeOdoo({ 'sale.order.search_read': [[saleRow({ state: 'cancel' })]] })
    const { writer, attempts } = throwingWriter()
    await expect(odooSaveQuotation({ reader: odoo, writer }, context().ctx, { ...CREATE_INPUT, clave })).rejects.toThrow(
      /La S00912 que creó esta vista previa está cancelada: pide una vista previa nueva/,
    )
    expect(attempts).toEqual([])
  })

  test('dos ventas con la misma marca no se adivinan: error que las nombra, sin escribir', async () => {
    const clave = await createKey()
    const { odoo } = fakeOdoo({ 'sale.order.search_read': [[saleRow(), saleRow({ id: 913, name: 'S00913' })]] })
    const { writer, attempts } = throwingWriter()
    await expect(odooSaveQuotation({ reader: odoo, writer }, context().ctx, { ...CREATE_INPUT, clave })).rejects.toThrow(
      /Hay al menos 2 ventas con la marca de esta vista previa \(S00912, S00913\)/,
    )
    expect(attempts).toEqual([])
  })

  test('un reintento con la clave ya vencida encuentra la que existía y no escribe; sin ella, responde que venció', async () => {
    const clave = await createKey()
    vi.setSystemTime(NOW + 45 * 60_000)

    const found = fakeOdoo({ 'sale.order.search_read': [[saleRow()]] })
    const { writer, attempts } = throwingWriter()
    await expect(odooSaveQuotation({ reader: found.odoo, writer }, context().ctx, { ...CREATE_INPUT, clave })).resolves.toMatchObject({
      ya_existia: true,
      cotizacion: { folio: 'S00912' },
    })

    const missing = fakeOdoo({ 'sale.order.search_read': [[]] })
    await expect(odooSaveQuotation({ reader: missing.odoo, writer }, context().ctx, { ...CREATE_INPUT, clave })).rejects.toThrow(
      PREVIEW_EXPIRED_MESSAGE,
    )
    expect(missing.calls).toHaveLength(1)
    expect(attempts).toEqual([])
  })

  test('una cotización idéntica se puede crear con otra vista previa', async () => {
    const first = await createKey()
    const second = await createKey()
    expect(second).not.toBe(first)

    const origins: string[] = []
    for (const [clave, id] of [[first, 912], [second, 913]] as const) {
      const { writer, calls } = fakeWriter({ 'sale.order.create': [[id]] })
      const script = createSaveScript({ 'sale.order.search_read': [[], [saleRow({ id, name: `S00${id}` })]] })
      const result = await odooSaveQuotation({ reader: fakeOdoo(script).odoo, writer }, context().ctx, { ...CREATE_INPUT, clave })
      expect(result).not.toHaveProperty('ya_existia')
      origins.push((calls[0].payload.vals_list as { origin: string }[])[0].origin)
    }
    expect(origins[0]).not.toBe(origins[1])
  })

  test('si el cliente o los productos cambiaron desde la vista previa no escribe', async () => {
    const clave = await createKey()
    const { writer, ops } = fakeWriter()
    const otherPartner = fakeOdoo(createSaveScript({ 'res.partner.search_read': [[{ ...COMPANY, id: 2 }]] }))
    await expect(odooSaveQuotation({ reader: otherPartner.odoo, writer }, context().ctx, { ...CREATE_INPUT, clave })).rejects.toThrow(
      PREVIEW_CHANGED_MESSAGE,
    )
    const archived = fakeOdoo(createSaveScript({ 'product.product.search_read': [[{ ...REPINTADO, active: false }]] }))
    await expect(odooSaveQuotation({ reader: archived.odoo, writer }, context().ctx, { ...CREATE_INPUT, clave })).rejects.toThrow(
      `${PREVIEW_CHANGED_MESSAGE} Línea 2: «Re pintado» (#30888) está archivado: reactívalo en Odoo.`,
    )
    expect(ops).toEqual([])
  })

  test('un producto que la vista aún no da de alta no deja guardar', async () => {
    const input: PreviewQuotationInput = {
      cliente: '#1',
      lineas: [{ codigo: 'ZZTEST144', descripcion: 'Producto de prueba del asistente', marca: 'PRUEBA', cantidad: 1, precio: 1 }],
    }
    const { data } = await preview(input, { ...createPreviewScript(), 'product.product.search_read': [[]] })
    const clave = data.clave as string
    const { writer, ops } = fakeWriter()
    const stillNew = fakeOdoo(createSaveScript({ 'product.product.search_read': [[]] }))
    await expect(odooSaveQuotation({ reader: stillNew.odoo, writer }, context().ctx, { ...input, clave })).rejects.toThrow(
      /^Línea 1: el producto aún no existe en Odoo\. Dalo de alta con el botón de la vista previa/,
    )
    expect(ops).toEqual([])

    // Once the button created it, the same key saves the quotation with it.
    const created = fakeOdoo(createSaveScript({ 'product.product.search_read': [[ZZTEST]] }))
    const { writer: w2, calls } = fakeWriter({ 'sale.order.create': [[912]] })
    await odooSaveQuotation({ reader: created.odoo, writer: w2 }, context().ctx, { ...input, clave })
    expect((calls[0].payload.vals_list as { order_line: unknown[] }[])[0].order_line).toEqual([
      [0, 0, { product_id: 32300, product_uom_qty: 1, price_unit: 1, discount: 0, sequence: 10 }],
    ])
  })
})

const editPreviewScript = (sale = saleRow(), lines: unknown[] = SALE_LINES): OdooScript => ({
  'sale.order.search_read': [[sale]],
  'sale.order.line.search_read': [lines],
  'product.product.search_read': [[REPINTADO, ZZTEST]],
})

async function editKey(input: PreviewQuotationInput = EDIT_INPUT, sale = saleRow()): Promise<string> {
  const { data } = await preview(input, editPreviewScript(sale))
  expect(data.bloqueos).toEqual([])
  return data.clave as string
}

describe('editar', () => {
  test('la vista previa de edición marca qué se queda, cambia y se quita', async () => {
    const { data, calls } = await preview(EDIT_INPUT, editPreviewScript())
    expect(calls[0].payload).toMatchObject({ domain: [['name', '=', 'S00912']] })
    expect(calls[0].payload.fields).not.toContain('internal_note')
    expect(data).toMatchObject({
      modo: 'editar',
      cotizacion: { id: 912, folio: 'S00912', estado: 'borrador', subtotal: 2, total: 2.32, moneda: 'MXN', vigencia: '2026-11-16' },
      subtotal: 2,
      puede_guardar: true,
    })
    expect(data.lineas.map((l) => [l.n, l.accion, l.linea_id])).toEqual([
      [1, 'se_queda', 7001],
      [2, 'cambia', 7002],
      [null, 'se_quita', 7003],
    ])
    expect(data.lineas[1]).toMatchObject({ cantidad: 2, antes: { cantidad: 1, precio: 1, descuento: 0 } })
  })

  test('guardar manda el diff y el rastro en una sola escritura, sin tocar las líneas que se quedan', async () => {
    const clave = await editKey()
    const { odoo } = fakeOdoo({
      'sale.order.search_read': [[saleRow()], [saleRow({ amount_untaxed: 2, amount_total: 2.32 })]],
      'sale.order.line.search_read': [SALE_LINES, [{ id: 7002, product_id: [30888, 'Re pintado'], price_unit: 1, qty_to_invoice: 0 }]],
      'product.product.search_read': [[REPINTADO, ZZTEST]],
    })
    const { writer, calls } = fakeWriter()
    const result = await odooSaveQuotation({ reader: odoo, writer }, context().ctx, { ...EDIT_INPUT, clave })

    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ model: 'sale.order', method: 'write' })
    expect(calls[0].payload).toEqual({
      ids: [912],
      vals: {
        order_line: [
          [1, 7002, { product_uom_qty: 2, price_unit: 1, discount: 0 }],
          [2, 7003, 0],
        ],
        // Appended to the owner's note, never replacing it.
        internal_note: `${ORIGINAL_NOTE}<p>Editada por el asistente a petición de Ana Admin · ${STAMP}</p>`,
      },
    })
    expect(result).toMatchObject({ quitadas: [ZZTEST.name], cotizacion: { folio: 'S00912', estado: 'borrador' } })
    expect(result.siguiente_paso).toBe('Se guardaron los cambios en la S00912; sigue como borrador.')
  })

  test('editar solo draft o sent; confirmada o bloqueada → error', async () => {
    for (const [sale, message] of [
      [saleRow({ state: 'sale' }), 'La S00912 ya es venta confirmada: no se edita desde el asistente (para facturar, odoo_create_draft_invoice).'],
      [saleRow({ state: 'cancel' }), /está cancelada/],
      [saleRow({ locked: true }), /está bloqueada en Odoo/],
    ] as const) {
      const { odoo, calls } = fakeOdoo({ 'sale.order.search_read': [[sale]] })
      const { writer, attempts } = throwingWriter()
      await expect(odooPreviewQuotation({ reader: odoo, writer }, context().ctx, EDIT_INPUT)).rejects.toThrow(message)
      expect(calls).toHaveLength(1)
      expect(attempts).toEqual([])
    }

    // A sent quote is editable, with a warning that Odoo won't resend it.
    const sent = await preview(EDIT_INPUT, editPreviewScript(saleRow({ state: 'sent' })))
    expect(sent.data.avisos).toContain('La S00912 ya se la enviaste al cliente: Odoo no se la reenvía al guardar los cambios.')
    expect(sent.data.cotizacion?.estado).toBe('enviada')

    // Confirmed between the preview and the save: nothing is written.
    const clave = await editKey()
    const { odoo } = fakeOdoo({
      'sale.order.search_read': [[saleRow({ state: 'sale' })]],
      'sale.order.line.search_read': [SALE_LINES],
      'product.product.search_read': [[REPINTADO, ZZTEST]],
    })
    const { writer, ops } = fakeWriter()
    await expect(odooSaveQuotation({ reader: odoo, writer }, context().ctx, { ...EDIT_INPUT, clave })).rejects.toThrow(
      /ya es venta confirmada/,
    )
    expect(ops).toEqual([])
  })

  test('write_date distinto y diff no vacío → error', async () => {
    const clave = await editKey()
    const { odoo } = fakeOdoo({
      'sale.order.search_read': [[saleRow({ write_date: '2026-10-17 22:59:00' })]],
      'sale.order.line.search_read': [SALE_LINES],
      'product.product.search_read': [[REPINTADO, ZZTEST]],
    })
    const { writer, ops } = fakeWriter()
    await expect(odooSaveQuotation({ reader: odoo, writer }, context().ctx, { ...EDIT_INPUT, clave })).rejects.toThrow(
      PREVIEW_CHANGED_MESSAGE,
    )
    expect(ops).toEqual([])
  })

  test('reintento de una edición ya aplicada → ya estaba así, cero escrituras', async () => {
    const clave = await editKey()
    // The first save landed: qty 2, ZZTEST gone, and a newer write_date.
    const applied = [SALE_LINES[0], { ...SALE_LINES[1], product_uom_qty: 2, price_subtotal: 2 }]
    const { odoo, calls } = fakeOdoo({
      'sale.order.search_read': [[saleRow({ write_date: '2026-10-17 23:00:05' })]],
      'sale.order.line.search_read': [applied],
      'product.product.search_read': [[REPINTADO]],
    })
    const { writer, attempts } = throwingWriter()
    const result = await odooSaveQuotation({ reader: odoo, writer }, context().ctx, { ...EDIT_INPUT, clave })
    expect(result).toMatchObject({ ya_existia: true, cotizacion: { folio: 'S00912' } })
    expect(result.siguiente_paso).toBe('La S00912 ya estaba así: no escribí nada.')
    expect(calls.map((c) => c.method)).toEqual(['search_read', 'search_read', 'search_read'])
    expect(attempts).toEqual([])
  })

  test('con la clave ya vencida, una edición aplicada responde ya estaba así; una pendiente no escribe', async () => {
    const clave = await editKey()
    vi.setSystemTime(NOW + 31 * 60_000)
    const applied = [SALE_LINES[0], { ...SALE_LINES[1], product_uom_qty: 2, price_subtotal: 2 }]
    const landed = fakeOdoo({
      'sale.order.search_read': [[saleRow({ write_date: '2026-10-17 23:00:05' })]],
      'sale.order.line.search_read': [applied],
      'product.product.search_read': [[REPINTADO]],
    })
    const { writer, attempts } = throwingWriter()
    await expect(odooSaveQuotation({ reader: landed.odoo, writer }, context().ctx, { ...EDIT_INPUT, clave })).resolves.toMatchObject({
      ya_existia: true,
      siguiente_paso: 'La S00912 ya estaba así: no escribí nada.',
    })

    // Not applied yet: the expired key never reaches the writer.
    const pending = fakeOdoo(editPreviewScript())
    await expect(odooSaveQuotation({ reader: pending.odoo, writer }, context().ctx, { ...EDIT_INPUT, clave })).rejects.toThrow(
      PREVIEW_EXPIRED_MESSAGE,
    )
    expect(attempts).toEqual([])
  })

  test('una línea que la entrada no puede expresar no se quita ni se cambia desde el asistente', async () => {
    const discount = { id: 7004, display_type: false, name: 'Descuento especial', product_id: [30889, 'Descuento'], product_uom_qty: 1, price_unit: -500, discount: 0, sequence: 40, price_subtotal: -500 }
    const lines = [...SALE_LINES.slice(0, 2), discount]
    const review = await preview({ folio: 'S00912' }, editPreviewScript(saleRow(), lines))
    expect(review.data.lineas_como_entrada).toEqual([
      { linea_id: 7001, nota: 'PRUEBA #144 — no procesar' },
      { linea_id: 7002, producto_id: 30888, cantidad: 1, precio: 1 },
    ])
    expect(review.data.avisos).toContain(
      'La línea 3 («Descuento especial») tiene precio -500: el asistente no puede conservarla al editar (no viene en lineas_como_entrada); para cambiar esta cotización, hazlo en Odoo. Confirmarla sí se puede.',
    )

    const edit = await preview(
      { folio: 'S00912', lineas: [...(review.data.lineas_como_entrada ?? []).slice(0, 1), { linea_id: 7002, cantidad: 2, precio: 1 }] },
      editPreviewScript(saleRow(), lines),
    )
    expect(edit.data.bloqueos).toEqual([
      'La línea #7004 («Descuento especial») tiene precio -500: el asistente no puede conservarla ni cambiarla; edita esta cotización en Odoo.',
    ])
    expect(edit.data.clave).toBeNull()

    // Sent back as it is, zod says why instead of a bare "inválida".
    const { odoo } = fakeOdoo({})
    const { writer } = throwingWriter()
    const echoed = { folio: 'S00912', lineas: [{ linea_id: 7004, producto_id: 30889, cantidad: 1, precio: -500 }] }
    await expect(odooPreviewQuotation({ reader: odoo, writer }, context().ctx, echoed)).rejects.toThrow(
      'Entrada inválida en lineas.0.precio: debe ser al menos 0. Revisa el formato y repite.',
    )
  })

  test('sin cambios la vista previa no da clave', async () => {
    const same = {
      folio: 'S00912',
      lineas: [
        { linea_id: 7001, nota: 'PRUEBA #144 — no procesar' },
        { linea_id: 7002, producto_id: 30888, cantidad: 1, precio: 1 },
        { linea_id: 7003, cantidad: 1, precio: 1 },
      ],
    }
    const { data } = await preview(same, editPreviewScript())
    expect(data.bloqueos).toEqual(['No hay cambios: la S00912 ya está así.'])
    expect(data.clave).toBeNull()
  })

  test('el folio debe ser exacto: uno parecido solo se sugiere', async () => {
    const { odoo, calls } = fakeOdoo({ 'sale.order.search_read': [[], [{ id: 912, name: 'S00912' }]] })
    const { writer } = throwingWriter()
    await expect(odooPreviewQuotation({ reader: odoo, writer }, context().ctx, { folio: 'S000912' })).rejects.toThrow(
      'No hay ninguna venta S000912 en Odoo. ¿Quisiste decir S00912? Pásame el folio completo.',
    )
    expect(calls[1].payload.domain).toEqual([['name', '=ilike', 'S%912']])
  })

  test('una cotización con demasiadas líneas se edita en Odoo', async () => {
    const many = Array.from({ length: 121 }, (_, i) => ({ ...SALE_LINES[1], id: 8000 + i, sequence: i }))
    const { odoo } = fakeOdoo({ 'sale.order.search_read': [[saleRow()]], 'sale.order.line.search_read': [many] })
    const { writer } = throwingWriter()
    await expect(odooPreviewQuotation({ reader: odoo, writer }, context().ctx, EDIT_INPUT)).rejects.toThrow(
      'La S00912 tiene más de 120 líneas: edítala en Odoo.',
    )
  })

  test('una línea que no es de la cotización bloquea la edición', async () => {
    const foreign = { folio: 'S00912', lineas: [{ linea_id: 9999, cantidad: 1, precio: 1 }] }
    const { data } = await preview(foreign, editPreviewScript())
    expect(data.bloqueos).toEqual(['Línea 1: la línea 9999 no es de esta cotización.'])
    expect(data.clave).toBeNull()
  })
})

const REVIEW_LINES = SALE_LINES.slice(0, 2)

describe('confirmar', () => {
  async function reviewKey(): Promise<string> {
    const { data } = await preview({ folio: 's00912' }, editPreviewScript(saleRow(), REVIEW_LINES))
    expect(data).toMatchObject({
      modo: 'revisar',
      puede_guardar: true,
      lineas_como_entrada: [
        { linea_id: 7001, nota: 'PRUEBA #144 — no procesar' },
        { linea_id: 7002, producto_id: 30888, cantidad: 1, precio: 1 },
      ],
    })
    expect(data.al_confirmar).toMatch(/^1 línea se podrá facturar en cuanto se confirme/)
    expect(data.siguiente_paso).toMatch(/confirmar: true y la clave/)
    return data.clave as string
  }

  const confirmScript = (overrides: OdooScript = {}): OdooScript => ({
    'sale.order.search_read': [[saleRow()], [saleRow({ state: 'sale', picking_ids: [650] })]],
    'sale.order.line.search_count': [1],
    'sale.order.line.search_read': [[{ id: 7002, product_id: [30888, 'Re pintado'], price_unit: 1, qty_to_invoice: 1 }]],
    'stock.picking.search_read': [[{ id: 650, name: 'OFI/OUT/00650', state: 'assigned' }]],
    ...overrides,
  })

  test('confirmar llama action_confirm sin contexto, deja rastro y reporta las entregas', async () => {
    const clave = await reviewKey()
    const { odoo } = fakeOdoo(confirmScript())
    const { writer, calls } = fakeWriter()
    const result = await odooSaveQuotation({ reader: odoo, writer }, context().ctx, { folio: 'S00912', confirmar: true, clave })

    expect(calls.map((c) => `${c.model}.${c.method}`)).toEqual(['sale.order.action_confirm', 'sale.order.write'])
    // No context at all: send_email would mail the customer.
    expect(calls[0].payload).toEqual({ ids: [912] })
    // The review key's marker: a retry after an uncertain confirm looks for it.
    expect(calls[1].payload).toEqual({
      ids: [912],
      vals: { internal_note: `${ORIGINAL_NOTE}<p>Confirmada por el asistente a petición de Ana Admin · ${STAMP} · clave ${k10Of(clave)}</p>` },
    })
    expect(result).toMatchObject({
      cotizacion: { folio: 'S00912', estado: 'venta confirmada' },
      confirmacion: { entregas: ['OFI/OUT/00650'], facturable_ya: 1 },
    })
    expect(result).not.toHaveProperty('aviso_rastro')
    expect(result.siguiente_paso).toMatch(/quedó como VENTA confirmada\. Para facturar: odoo_create_draft_invoice/)
  })

  test('reintento tras confirmar → ya estaba confirmada, cero escrituras', async () => {
    const clave = await reviewKey()
    vi.setSystemTime(NOW + 40 * 60_000)
    const trailed = `${ORIGINAL_NOTE}<p>Confirmada por el asistente a petición de Ana Admin · ${STAMP} · clave ${k10Of(clave)}</p>`
    const confirmed = saleRow({ state: 'sale', write_date: '2026-10-17 23:05:00', internal_note: trailed })
    const { odoo } = fakeOdoo(confirmScript({ 'sale.order.search_read': [[confirmed], [saleRow({ state: 'sale', picking_ids: [] })]] }))
    const { writer, attempts } = throwingWriter()
    const result = await odooSaveQuotation({ reader: odoo, writer }, context().ctx, { folio: 'S00912', confirmar: true, clave })
    expect(result).toMatchObject({ ya_existia: true, confirmacion: { entregas: [], facturable_ya: 1 } })
    expect(result.siguiente_paso).toBe('La S00912 ya estaba confirmada: no escribí nada.')
    expect(result).not.toHaveProperty('aviso_rastro')
    expect(attempts).toEqual([])
  })

  test('confirmación incierta: el reintento la encuentra confirmada sin rastro y lo avisa', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const clave = await reviewKey()
    const { writer, calls } = fakeWriter({ 'sale.order.action_confirm': [new OdooUncertainWriteError('sale.order.action_confirm', 'quotation', 504)] })
    const failure = await odooSaveQuotation({ reader: fakeOdoo(confirmScript()).odoo, writer }, context().ctx, {
      folio: 'S00912',
      confirmar: true,
      clave,
    }).catch((e: unknown) => e)
    expect(failure).toBeInstanceOf(OdooUncertainWriteError)
    // The trail never went out: action_confirm was the last attempt.
    expect(calls.map((c) => c.method)).toEqual(['action_confirm'])

    // Odoo did confirm it; another trail ("Confirmada" from an older key) doesn't count.
    const older = `${ORIGINAL_NOTE}<p>Confirmada por el asistente a petición de Ana Admin · 2026-10-01 10:00 · clave 0123456789</p>`
    const { odoo } = fakeOdoo(confirmScript({ 'sale.order.search_read': [[saleRow({ state: 'sale', internal_note: older })], [saleRow({ state: 'sale', picking_ids: [650] })]] }))
    const { writer: never, attempts } = throwingWriter()
    const retry = await odooSaveQuotation({ reader: odoo, writer: never }, context().ctx, { folio: 'S00912', confirmar: true, clave })
    expect(retry).toMatchObject({ ya_existia: true, cotizacion: { estado: 'venta confirmada' } })
    expect(retry.aviso_rastro).toBe(
      'La S00912 está confirmada, pero su nota interna no dice que la confirmó el asistente con esta clave: si fue esta llamada (quedó incierta), anota en Odoo quién la pidió.',
    )
    expect(error).toHaveBeenCalledWith('[odoo-write] confirmed sale without the trail of this key', { saleId: 912 })
    expect(attempts).toEqual([])
  })

  test('la vigencia no viaja con una revisión ni con confirmar: se cambia editando', async () => {
    const { odoo, calls } = fakeOdoo({})
    const { writer, ops } = fakeWriter()
    await expect(odooPreviewQuotation({ reader: odoo, writer }, context().ctx, { folio: 'S00912', vigencia: '2026-10-30' })).rejects.toThrow(
      /La vigencia se cambia editando/,
    )
    await expect(
      odooSaveQuotation({ reader: odoo, writer }, context().ctx, { folio: 'S00912', confirmar: true, vigencia: '2026-10-30', clave: 'a.b' }),
    ).rejects.toThrow(/La vigencia se cambia editando/)
    expect(calls).toEqual([])
    expect(ops).toEqual([])
  })

  test('si el rastro falla, la venta queda confirmada y sale aviso', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const clave = await reviewKey()
    const { odoo } = fakeOdoo(confirmScript())
    const { writer, calls } = fakeWriter({ 'sale.order.write': [new OdooError('Odoo rechazó sale.order.write: boom', 400)] })
    const result = await odooSaveQuotation({ reader: odoo, writer }, context().ctx, { folio: 'S00912', confirmar: true, clave })

    expect(calls.map((c) => c.method)).toEqual(['action_confirm', 'write'])
    expect(result.aviso_rastro).toBe('La S00912 quedó confirmada, pero no pude anotar en su nota interna quién la confirmó.')
    expect(result.cotizacion.estado).toBe('venta confirmada')
    expect(error).toHaveBeenCalledWith('[odoo-write] trail failed after confirming', { saleId: 912, error: 'OdooError' })
  })

  test('confirmar exige folio y prohíbe líneas', async () => {
    const { odoo, calls } = fakeOdoo({})
    const { writer, ops } = fakeWriter()
    await expect(
      odooSaveQuotation({ reader: odoo, writer }, context().ctx, { folio: 'S00912', confirmar: true, lineas: [NOTE_LINE], clave: 'a.b' }),
    ).rejects.toThrow(/Confirmar exige el folio y ninguna línea/)
    await expect(
      odooSaveQuotation({ reader: odoo, writer }, context().ctx, { cliente: '#1', confirmar: true, clave: 'a.b' }),
    ).rejects.toThrow(/Confirmar exige el folio/)
    await expect(odooSaveQuotation({ reader: odoo, writer }, context().ctx, { folio: 'S00912', clave: 'a.b' })).rejects.toThrow(
      /Con solo el folio no hay nada que guardar/,
    )
    expect(calls).toEqual([])
    expect(ops).toEqual([])
  })

  test('confirmar sin productos o con la venta modificada no escribe', async () => {
    const clave = await reviewKey()
    const { writer, ops } = fakeWriter()
    const empty = fakeOdoo(confirmScript({ 'sale.order.line.search_count': [0] }))
    await expect(
      odooSaveQuotation({ reader: empty.odoo, writer }, context().ctx, { folio: 'S00912', confirmar: true, clave }),
    ).rejects.toThrow('La S00912 no tiene productos: no se puede confirmar.')
    const touched = fakeOdoo(confirmScript({ 'sale.order.search_read': [[saleRow({ write_date: '2026-10-17 22:59:59' })]] }))
    await expect(
      odooSaveQuotation({ reader: touched.odoo, writer }, context().ctx, { folio: 'S00912', confirmar: true, clave }),
    ).rejects.toThrow(PREVIEW_CHANGED_MESSAGE)
    expect(ops).toEqual([])
  })
})

describe('fallos', () => {
  test('timeout al crear → resultado desconocido que pide repetir la misma llamada', async () => {
    const clave = await createKey()
    const { writer } = fakeWriter({ 'sale.order.create': [new OdooUncertainWriteError('sale.order.create', 'quotation', 504)] })
    const failure = await odooSaveQuotation({ reader: fakeOdoo(createSaveScript()).odoo, writer }, context().ctx, {
      ...CREATE_INPUT,
      clave,
    }).catch((e: unknown) => e)
    expect(failure).toBeInstanceOf(OdooUncertainWriteError)
    expect((failure as Error).message).toMatch(/Repite exactamente la misma llamada \(o el mismo clic\): con la misma clave no se duplica/)

    // Repeating the same call finds the order if Odoo did save it.
    const { odoo } = fakeOdoo({ 'sale.order.search_read': [[saleRow()]] })
    const { writer: never, attempts } = throwingWriter()
    await expect(odooSaveQuotation({ reader: odoo, writer: never }, context().ctx, { ...CREATE_INPUT, clave })).resolves.toMatchObject({
      ya_existia: true,
    })
    expect(attempts).toEqual([])
  })

  test('si no puedo releer tras escribir, la escritura no se vuelve error', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const clave = await createKey()
    const { odoo } = fakeOdoo(createSaveScript({ 'sale.order.search_read': [[], new Error('red caída')] }))
    const { writer } = fakeWriter({ 'sale.order.create': [[912]] })
    const result = await odooSaveQuotation({ reader: odoo, writer }, context().ctx, { ...CREATE_INPUT, clave })
    expect(result).toMatchObject({ cotizacion: { id: 912, folio: null, estado: 'borrador', cliente: COMPANY.name } })
    expect(result.aviso_relectura).toMatch(/Se guardó en Odoo \(id 912\)/)
    expect(error).toHaveBeenCalledWith('[odoo-write] reread after write failed', { saleId: 912, error: 'Error' })
  })

  test('una entrada fuera de forma se rechaza antes de leer Odoo', async () => {
    const { odoo, calls } = fakeOdoo({})
    const { writer } = throwingWriter()
    const bad = { cliente: '#1', lineas: [{ codigo: '5467', cantidad: 1, precio: 1, inventado: true }] } as unknown as PreviewQuotationInput
    await expect(odooPreviewQuotation({ reader: odoo, writer }, context().ctx, bad)).rejects.toThrow(/^Entrada inválida en lineas\.0/)
    await expect(odooPreviewQuotation({ reader: odoo, writer }, context().ctx, { folio: '912' })).rejects.toThrow(
      /folio de venta de Odoo, ej\. S00912/,
    )
    await expect(odooPreviewQuotation({ reader: odoo, writer }, context().ctx, { ...CREATE_INPUT, vigencia: '2026-10-01' })).rejects.toThrow(
      'La vigencia 2026-10-01 ya pasó: usa hoy o una fecha posterior.',
    )
    expect(calls).toEqual([])
  })
})

describe('límites de líneas (review PR #149)', () => {
  test('la edición más grande que deja pasar la vista previa cabe en una sola escritura', () => {
    // Every current line may be removed and every desired line added in the same write.
    expect(MAX_EDIT_LINES + MAX_QUOTATION_LINES).toBeLessThanOrEqual(MAX_LINE_COMMANDS)
  })
})
