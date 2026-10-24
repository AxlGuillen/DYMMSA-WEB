/** Odoo writer (#144, ADR-040): typed facade, guarded transport on the shared queue, deadline and
 *  uncertain outcomes. Fake transports and a reserved .test host only — nothing reaches Odoo. */

import { describe, test, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  createOdooCaller,
  createOdooQueue,
  createOdooRawWriter,
  OdooError,
  OdooUncertainWriteError,
  type OdooQueue,
} from '@/lib/odoo/client'
import {
  PRE_TOOL_HEADROOM_MS,
  REQUEST_BUDGET_MS,
  startDeadline,
  writeTimeoutMs,
  type Deadline,
} from '@/lib/odoo/deadline'
import { isOdooWriteConfigured, odooWriteEnv } from '@/lib/odoo/env'
import type { ProductCreateVals, SaleLineCommand } from '@/lib/odoo/write-catalog'
import { createOdooWriter, odooWriter, ownedSaleLines, trailNote, type OdooWriter } from '@/lib/odoo/writer'
import { ADMIN_ONLY_MESSAGE, ADMIN_PROOF_TTL_MS, issueAdminProof, type AdminProof } from '@/lib/odoo/write-guard'
import {
  PREVIEW_CHANGED_MESSAGE,
  PREVIEW_EXPIRED_MESSAGE,
  PREVIEW_GRANT_MISSING_MESSAGE,
  PREVIEW_KEY_OTHER_ADMIN_MESSAGE,
  PREVIEW_TTL_MS,
  type PreviewGrant,
  type QuotationKeyKind,
} from '@/lib/odoo/preview-token'
import { fakeRawWriter, fakeWriter, testAdminProof, testPreviewGrant, throwingWriter } from '../helpers/fake-odoo'
import { MCP_MAX_DURATION_S } from '@/lib/mcp/core/http'

const WRITE_KEY = 'write-key-0123456789abcdef'
const ENV = { url: 'https://odoo.test', apiKey: WRITE_KEY, db: null }
// 2026-10-17 22:00 UTC = 16:00 in Morelia (UTC-6 all year since 2022).
const NOW = Date.UTC(2026, 9, 17, 22, 0)
const STAMP = '2026-10-17 16:00'
const KEYS = { k10: '0123456789', h10: 'abcdef0123' }
const PRODUCT_LINE = { product_id: 30888, product_uom_qty: 1, price_unit: 1, discount: 0, sequence: 20 }
const NOTE_LINE = { display_type: 'line_note' as const, name: 'PRUEBA #144 — no procesar', sequence: 10 }
const SALE_CONTEXT = { active_model: 'sale.order', active_ids: [912], active_id: 912 }
const SLOW = 'Odoo va lento: no escribí nada para no dejarlo a medias. Vuelve a intentarlo.'
// S00912 as reread: 4711 and 4712 are product lines, 4713 is a note.
const OWNED = () =>
  ownedSaleLines([
    { id: 4711, display_type: false },
    { id: 4712, display_type: false },
    { id: 4713, display_type: 'line_note' },
  ])

const fixedDeadline = (remainingMs = 60_000): Deadline => ({ remainingMs: () => remainingMs })

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers })

function rawWriter(
  opts: {
    responses?: (Response | Error)[]
    queue?: OdooQueue
    clock?: { now: number }
    env?: typeof ENV
    timeoutSignal?: (ms: number) => AbortSignal
  } = {},
) {
  const requests: Request[] = []
  const sleeps: number[] = []
  const pending = [...(opts.responses ?? [])]
  const write = createOdooRawWriter({
    getEnv: () => opts.env ?? ENV,
    queue: opts.queue ?? createOdooQueue({ spacingMs: 0 }),
    sleepFn: async (ms) => {
      sleeps.push(ms)
      if (opts.clock) opts.clock.now += ms
    },
    fetchFn: async (request) => {
      requests.push(request)
      const next = pending.shift() ?? json(true)
      if (next instanceof Error) throw next
      return next
    },
    timeoutSignal: opts.timeoutSignal,
  })
  return { write, requests, sleeps }
}

/** Captures the write timeout instead of arming a real one. */
const recordTimeout = (seen: number[]) => (ms: number) => {
  seen.push(ms)
  return new AbortController().signal
}

type GrantFor = (kind: QuotationKeyKind) => PreviewGrant

/** Every facade operation with valid arguments, to prove a rule holds for all six. */
function everyOperation(
  writer: OdooWriter,
  proof: AdminProof,
  dl: Deadline,
  grantFor: GrantFor = (kind) => testPreviewGrant({ kind }),
): [string, () => Promise<unknown>][] {
  return [
    ['createQuotation', () => writer.createQuotation(proof, grantFor('crear'), { partner_id: 1, lines: [PRODUCT_LINE] }, dl)],
    ['updateQuotation', () => writer.updateQuotation(proof, grantFor('editar'), 912, { validity_date: '2026-11-16' }, OWNED(), '', dl)],
    ['confirmSale', () => writer.confirmSale(proof, grantFor('confirmar'), 912, dl)],
    ['appendSaleTrail', () => writer.appendSaleTrail(proof, 912, '', 'Confirmada', dl)],
    ['createProducts', () => writer.createProducts(proof, [{ name: 'ZZTEST144 X PRUEBA', list_price: 1, type: 'consu', sale_ok: true }], dl)],
    ['createDraftInvoice', () => writer.createDraftInvoice(proof, 912, dl)],
  ]
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('fachada del escritor (#144)', () => {
  test('el escritor expone exactamente seis operaciones', () => {
    const six = ['appendSaleTrail', 'confirmSale', 'createDraftInvoice', 'createProducts', 'createQuotation', 'updateQuotation']
    expect(Object.keys(odooWriter).sort()).toEqual(six)
    expect(Object.isFrozen(odooWriter)).toBe(true)
    expect(Object.keys(fakeWriter().writer).sort()).toEqual(six)
    expect(Object.keys(throwingWriter().writer).sort()).toEqual(six)
  })

  test('sin prueba de administrador vigente no escribe (falsa, vencida)', async () => {
    let clock = NOW
    const { writer, calls } = fakeWriter({}, { now: () => clock })
    const real = testAdminProof({ now: NOW })
    const forged = { userId: 'admin-1', displayName: 'Ana Admin', issuedAt: NOW } as unknown as AdminProof
    const copied = { ...real } as AdminProof

    const grantFor: GrantFor = (kind) => testPreviewGrant({ kind, now: NOW })

    for (const proof of [forged, copied, null as unknown as AdminProof]) {
      for (const [name, run] of everyOperation(writer, proof, fixedDeadline(), grantFor)) {
        await expect(run(), name).rejects.toThrow(ADMIN_ONLY_MESSAGE)
      }
    }

    clock = NOW + ADMIN_PROOF_TTL_MS + 1
    for (const [name, run] of everyOperation(writer, real, fixedDeadline(), grantFor)) {
      await expect(run(), name).rejects.toThrow(/verificación de administrador venció/)
    }
    // A proof dated in the future is not "fresh" either.
    clock = NOW
    const future = testAdminProof({ now: NOW + 5_000 })
    await expect(writer.confirmSale(future, grantFor('confirmar'), 912, fixedDeadline())).rejects.toThrow(/venció/)
    expect(calls).toHaveLength(0)

    // Within its 90 s it works.
    clock = NOW + ADMIN_PROOF_TTL_MS
    await writer.confirmSale(real, grantFor('confirmar'), 912, fixedDeadline())
    expect(calls).toHaveLength(1)

    // A proof is never issued without who asked.
    expect(() => issueAdminProof({ userId: 'admin-1', displayName: '   ' })).toThrow(ADMIN_ONLY_MESSAGE)
    expect(() => issueAdminProof({ userId: '', displayName: 'Ana' })).toThrow(ADMIN_ONLY_MESSAGE)
  })

  test('sin permiso de vista previa vigente no crea, edita ni confirma', async () => {
    let clock = NOW
    const { writer, calls } = fakeWriter({ 'sale.order.create': [[912]] }, { now: () => clock })
    const proof = testAdminProof({ now: NOW })
    const create = { partner_id: 1, lines: [PRODUCT_LINE] }
    const edit = { validity_date: '2026-11-16' }
    const grant = (kind: QuotationKeyKind, extra: { saleId?: number | null; partnerId?: number; userId?: string } = {}) =>
      testPreviewGrant({ kind, now: NOW, ...extra })

    const refused: [string, () => Promise<unknown>, string | RegExp][] = [
      // Forged or copied: only a grant minted by grantPreviewWrite() counts.
      ['copia', () => writer.confirmSale(proof, { ...grant('confirmar') }, 912, fixedDeadline()), PREVIEW_GRANT_MISSING_MESSAGE],
      ['nulo', () => writer.createQuotation(proof, null as unknown as PreviewGrant, create, fixedDeadline()), PREVIEW_GRANT_MISSING_MESSAGE],
      // A review key confirms; it never creates nor edits.
      ['revisar edita', () => writer.updateQuotation(proof, grant('confirmar'), 912, edit, OWNED(), '', fixedDeadline()), /para confirmar la venta, no para editar/],
      ['editar crea', () => writer.createQuotation(proof, grant('editar'), create, fixedDeadline()), /para editar la cotización, no para crear/],
      ['otra venta', () => writer.confirmSale(proof, grant('confirmar', { saleId: 913 }), 912, fixedDeadline()), PREVIEW_CHANGED_MESSAGE],
      ['otro cliente', () => writer.createQuotation(proof, grant('crear', { partnerId: 17 }), create, fixedDeadline()), PREVIEW_CHANGED_MESSAGE],
      ['otro admin', () => writer.confirmSale(proof, grant('confirmar', { userId: 'admin-2' }), 912, fixedDeadline()), PREVIEW_KEY_OTHER_ADMIN_MESSAGE],
    ]
    for (const [label, attempt, message] of refused) await expect(attempt(), label).rejects.toThrow(message)
    expect(calls).toHaveLength(0)

    // Checked again when the write leaves: a grant that crossed its 30 min no longer writes.
    const live = grant('editar')
    clock = NOW + PREVIEW_TTL_MS
    const late = testAdminProof({ now: clock })
    await expect(writer.updateQuotation(late, live, 912, edit, OWNED(), '', fixedDeadline())).rejects.toThrow(PREVIEW_EXPIRED_MESSAGE)
    expect(calls).toHaveLength(0)

    clock = NOW
    await expect(writer.createQuotation(proof, grant('crear'), create, fixedDeadline())).resolves.toBe(912)
    expect(calls).toHaveLength(1)
  })

  test('createQuotation pone el marcador, la nota de rastro y envuelve las líneas en [0, 0, v]', async () => {
    const { writer, calls, logs } = fakeWriter({ 'sale.order.create': [[912]] }, { now: () => NOW })
    const proof = testAdminProof({ now: NOW })
    const grant = testPreviewGrant({ now: NOW })
    const { k10, h10 } = grant.markers
    const id = await writer.createQuotation(
      proof,
      grant,
      { partner_id: 1, validity_date: '2026-11-16', lines: [NOTE_LINE, PRODUCT_LINE] },
      fixedDeadline(),
    )
    expect(id).toBe(912)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ model: 'sale.order', method: 'create' })
    expect(calls[0].payload).toEqual({
      vals_list: [
        {
          partner_id: 1,
          origin: `Asistente DYMMSA · ${k10}`,
          internal_note: `<p>Creada por el asistente (MCP) a petición de Ana Admin · ${STAMP} · clave ${k10} · contenido ${h10}</p>`,
          validity_date: '2026-11-16',
          order_line: [
            [0, 0, NOTE_LINE],
            [0, 0, PRODUCT_LINE],
          ],
        },
      ],
    })
    // The log carries ids and the actor, never amounts nor names.
    expect(logs).toEqual([{ op: 'sale.order.create', ids: [912], actor: 'admin-1' }])
  })

  test('createQuotation: un resultado raro es incierto', async () => {
    const proof = testAdminProof()
    const { writer } = fakeWriter({ 'sale.order.create': [[], [912, 913]] })
    const vals = { partner_id: 1, lines: [PRODUCT_LINE] }

    // The order may exist already: the caller repeats with the same key, never a new preview.
    for (let i = 0; i < 2; i++) {
      const error = await writer.createQuotation(proof, testPreviewGrant(), vals, fixedDeadline()).catch((e) => e)
      expect(error).toBeInstanceOf(OdooUncertainWriteError)
      expect(error.operation).toBe('sale.order.create')
      expect(error.retry).toBe('quotation')
    }
  })

  test('createDraftInvoice arma sale_order_ids y el contexto active_* desde el id', async () => {
    const { writer, calls, logs } = fakeWriter({ 'sale.advance.payment.inv.create': [[77]] })
    await writer.createDraftInvoice(testAdminProof(), 912, fixedDeadline())
    expect(calls.map(({ model, method, payload }) => ({ model, method, payload }))).toEqual([
      {
        model: 'sale.advance.payment.inv',
        method: 'create',
        payload: {
          vals_list: [{ advance_payment_method: 'delivered', sale_order_ids: [[6, 0, [912]]] }],
          context: SALE_CONTEXT,
        },
      },
      // No open_invoices: the tool rereads invoice_ids instead of the returned action.
      { model: 'sale.advance.payment.inv', method: 'create_invoices', payload: { ids: [77], context: SALE_CONTEXT } },
    ])
    expect(logs.map((l) => l.op)).toEqual(['sale.advance.payment.inv.create', 'sale.advance.payment.inv.create_invoices'])

    // No wizard id → nothing invoiced, and create_invoices never runs.
    const odd = fakeWriter({ 'sale.advance.payment.inv.create': [true] })
    await expect(odd.writer.createDraftInvoice(testAdminProof(), 912, fixedDeadline())).rejects.toThrow(
      /no se creó ninguna factura/,
    )
    expect(odd.calls.map((c) => c.method)).toEqual(['create'])
  })

  test('confirmSale nunca manda context', async () => {
    const { writer, calls } = fakeWriter()
    await writer.confirmSale(testAdminProof(), testPreviewGrant({ kind: 'confirmar' }), 912, fixedDeadline())
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ model: 'sale.order', method: 'action_confirm' })
    expect(calls[0].payload).toEqual({ ids: [912] })
    expect('context' in calls[0].payload).toBe(false)

    // On the wire too: the body is exactly the id.
    const { write, requests } = rawWriter()
    await createOdooWriter(write, { log: () => undefined }).confirmSale(
      testAdminProof(),
      testPreviewGrant({ kind: 'confirmar' }),
      912,
      fixedDeadline(),
    )
    expect(requests[0].url).toBe('https://odoo.test/json/2/sale.order/action_confirm')
    expect(await requests[0].text()).toBe('{"ids":[912]}')
  })

  test('updateQuotation rechaza comandos sobre líneas de otra venta', async () => {
    const { writer, calls } = fakeWriter({}, { now: () => NOW })
    const proof = testAdminProof({ now: NOW })
    const grant = testPreviewGrant({ kind: 'editar', now: NOW })
    const update = [1, 999, { product_uom_qty: 2, price_unit: 1, discount: 0 }] as const
    for (const command of [update, [2, 999, 0] as const]) {
      await expect(
        writer.updateQuotation(proof, grant, 912, { order_line: [command] }, OWNED(), '<p>previa</p>', fixedDeadline()),
      ).rejects.toThrow('La línea 999 no es de esta cotización: no escribí nada.')
    }
    await expect(writer.updateQuotation(proof, grant, 912, {}, OWNED(), '', fixedDeadline())).rejects.toThrow(/No hay cambios/)
    expect(calls).toHaveLength(0)

    // Its own lines and new ones go out in ONE write with the trail.
    const commands = [
      [0, 0, PRODUCT_LINE],
      [1, 4711, { product_uom_qty: 2, price_unit: 1, discount: 0 }],
      [2, 4712, 0],
      [1, 4713, { name: 'Tiempo de entrega: 3 a 5 días hábiles' }],
    ] as const
    await writer.updateQuotation(proof, grant, 912, { order_line: commands }, OWNED(), '<p>previa</p>', fixedDeadline())
    expect(calls).toHaveLength(1)
    expect(calls[0].payload).toEqual({
      ids: [912],
      vals: {
        order_line: commands,
        internal_note: `<p>previa</p><p>Editada por el asistente a petición de Ana Admin · ${STAMP}</p>`,
      },
    })
  })

  test('un [1] se valida contra el tipo de la línea: a una de producto no se le cambia solo el texto ni la secuencia', async () => {
    const { writer, calls } = fakeWriter()
    const proof = testAdminProof()
    const grant = testPreviewGrant({ kind: 'editar' })
    const refused: [SaleLineCommand, RegExp][] = [
      // The catalog alone would let these through: only the line's kind tells them apart.
      [[1, 4711, { name: 'texto libre' }], /La línea 4711 es de producto: un cambio lleva cantidad, precio y descuento/],
      [[1, 4711, { sequence: 30 }], /La línea 4711 es de producto/],
      [[1, 4713, { product_uom_qty: 2, price_unit: 1, discount: 0 }], /La línea 4713 es una nota o sección/],
    ]
    for (const [command, message] of refused) {
      await expect(
        writer.updateQuotation(proof, grant, 912, { order_line: [command] }, OWNED(), '', fixedDeadline()),
        JSON.stringify(command),
      ).rejects.toThrow(message)
    }
    expect(calls).toHaveLength(0)

    for (const command of [
      [1, 4711, { product_uom_qty: 2, price_unit: 1, discount: 0, sequence: 30 }],
      [1, 4713, { sequence: 5 }],
      [2, 4713, 0],
    ] satisfies SaleLineCommand[]) {
      await writer.updateQuotation(proof, grant, 912, { order_line: [command] }, OWNED(), '', fixedDeadline())
    }
    expect(calls).toHaveLength(3)

    // Rows read without display_type (or a bad id) never become an ownership map.
    for (const rows of [[{ id: 4711, display_type: undefined }], [{ id: 4711, display_type: null }], [{ id: '4711', display_type: false }], [{ id: 0, display_type: false }]]) {
      expect(() => ownedSaleLines(rows), JSON.stringify(rows)).toThrow('No pude leer las líneas de la cotización: no escribí nada.')
    }
  })

  test('una nota que no se leyó nunca borra la del dueño', async () => {
    const { writer, calls } = fakeWriter({}, { now: () => NOW })
    const proof = testAdminProof({ now: NOW })
    const grant = testPreviewGrant({ kind: 'editar', now: NOW })
    for (const note of [undefined, null, 0, {}]) {
      const unread = note as unknown as string
      await expect(
        writer.updateQuotation(proof, grant, 912, { validity_date: '2026-11-16' }, OWNED(), unread, fixedDeadline()),
      ).rejects.toThrow('No pude leer la nota interna de la venta: no escribí nada.')
      await expect(writer.appendSaleTrail(proof, 912, unread, 'Confirmada', fixedDeadline())).rejects.toThrow(
        'No pude leer la nota interna',
      )
    }
    expect(calls).toHaveLength(0)

    // A long owner note (pasted mail, inline styles) still takes the edit and its trail.
    const longNote = `<p style="color:#333">${'x'.repeat(25_000)}</p>`
    await writer.updateQuotation(proof, grant, 912, { validity_date: '2026-11-16' }, OWNED(), longNote, fixedDeadline())
    expect(calls).toHaveLength(1)
    expect((calls[0].payload.vals as { internal_note: string }).internal_note.startsWith(longNote)).toBe(true)
  })

  test('el rastro incierto tras facturar da el consejo de la factura, no el de la clave', async () => {
    const quotationUncertain = () => new OdooUncertainWriteError('sale.order.write', 'quotation')
    const { writer } = fakeWriter({
      'sale.order.write': [quotationUncertain(), quotationUncertain(), new OdooError('Odoo rechazó sale.order.write: x', 400)],
    })
    const proof = testAdminProof()

    const afterInvoice = await writer.appendSaleTrail(proof, 912, '', 'Factura en borrador creada', fixedDeadline()).catch((e) => e)
    expect(afterInvoice).toBeInstanceOf(OdooUncertainWriteError)
    expect(afterInvoice.retry).toBe('invoice')
    expect(afterInvoice.message).toContain('con el mismo folio')
    expect(afterInvoice.message).not.toContain('No pidas otra vista previa')

    const afterConfirm = await writer.appendSaleTrail(proof, 912, '', 'Confirmada', fixedDeadline()).catch((e) => e)
    expect(afterConfirm.retry).toBe('quotation')

    // A definitive refusal passes through untouched.
    const refused = await writer.appendSaleTrail(proof, 912, '', 'Factura en borrador creada', fixedDeadline()).catch((e) => e)
    expect(refused).not.toBeInstanceOf(OdooUncertainWriteError)
    expect(refused.status).toBe(400)
  })

  test('el rastro se agrega al final de la nota, nunca la reemplaza, y escapa el nombre', async () => {
    const { writer, calls } = fakeWriter({ 'sale.order.create': [[912]] }, { now: () => NOW })
    const proof = testAdminProof({ displayName: `Ana <b>"O'Neil"</b> & Co`, now: NOW })
    const grant = testPreviewGrant({ now: NOW })
    const { k10, h10 } = grant.markers
    const escaped = 'Ana &lt;b&gt;&quot;O&#39;Neil&quot;&lt;/b&gt; &amp; Co'

    await writer.appendSaleTrail(proof, 912, '<p>Nota del dueño</p>', 'Confirmada', fixedDeadline())
    // Odoo answers an empty html field with false: the trail alone, never "false<p>".
    await writer.appendSaleTrail(proof, 912, false, 'Factura en borrador creada', fixedDeadline())
    await writer.createQuotation(proof, grant, { partner_id: 1, lines: [PRODUCT_LINE] }, fixedDeadline())

    expect(calls.map((c) => c.payload)).toEqual([
      {
        ids: [912],
        vals: { internal_note: `<p>Nota del dueño</p><p>Confirmada por el asistente a petición de ${escaped} · ${STAMP}</p>` },
      },
      {
        ids: [912],
        vals: { internal_note: `<p>Factura en borrador creada por el asistente a petición de ${escaped} · ${STAMP}</p>` },
      },
      expect.objectContaining({
        vals_list: [
          expect.objectContaining({
            internal_note: `<p>Creada por el asistente (MCP) a petición de ${escaped} · ${STAMP} · clave ${k10} · contenido ${h10}</p>`,
          }),
        ],
      }),
    ])
    expect(JSON.stringify(calls)).not.toContain('<b>')
  })

  test('el rastro de creación cabe en el tope del catálogo aun con el nombre más largo', () => {
    // display_name is 1..80 chars; "&" is the worst case for escaping.
    const note = trailNote('Creada', '&'.repeat(80), new Date(NOW), KEYS)
    expect(note.length).toBeLessThanOrEqual(1_000)
    expect(trailNote('Editada', 'Ana', new Date(Date.UTC(2026, 0, 1, 5, 30)))).toBe(
      '<p>Editada por el asistente a petición de Ana · 2025-12-31 23:30</p>',
    )
  })

  test('createProducts devuelve un id por producto; si no cuadran, el resultado es incierto', async () => {
    const products = [
      { name: 'ZZTEST144 Uno PRUEBA', list_price: 1, type: 'consu' as const, sale_ok: true as const },
      { name: 'ZZTEST144 Dos PRUEBA', list_price: 2, type: 'consu' as const, sale_ok: true as const, default_code: '510033153' },
    ]
    const { writer, calls } = fakeWriter({ 'product.product.create': [[501, 502], [501]] })
    await expect(writer.createProducts(testAdminProof(), products, fixedDeadline())).resolves.toEqual([501, 502])
    expect(calls[0].payload).toEqual({ vals_list: products })
    const error = await writer.createProducts(testAdminProof(), products, fixedDeadline()).catch((e) => e)
    expect(error).toBeInstanceOf(OdooUncertainWriteError)
    expect(error.retry).toBe('products')
  })

  test('el catálogo real valida lo que arma la fachada: un producto de servicio no pasa', async () => {
    const { writer, calls } = fakeWriter()
    const service = { name: 'Servicio', list_price: 1, type: 'service', sale_ok: true } as unknown as ProductCreateVals
    await expect(writer.createProducts(testAdminProof(), [service], fixedDeadline())).rejects.toThrow(OdooError)
    // The attempt is recorded, but the fake transport refused it like production would.
    expect(calls).toHaveLength(1)
  })
})

describe('transporte de escritura (#144)', () => {
  test('lector y escritor comparten la cola', async () => {
    const queue = createOdooQueue({ spacingMs: 0 })
    const flight = { now: 0, max: 0 }
    const track = async <T>(result: T): Promise<T> => {
      flight.now++
      flight.max = Math.max(flight.max, flight.now)
      await Promise.resolve()
      flight.now--
      return result
    }
    const reader = createOdooCaller({ queue, getEnv: () => ENV, fetchFn: () => track(json(3)) })
    const write = createOdooRawWriter({ queue, getEnv: () => ENV, fetchFn: () => track(json(true)) })
    await Promise.all([
      reader('sale.order', 'search_count', {}),
      write('sale.order', 'action_confirm', { ids: [912] }, fixedDeadline()),
      reader('res.partner', 'search_count', {}),
      write('sale.order', 'action_confirm', { ids: [913] }, fixedDeadline()),
    ])
    expect(flight.max).toBe(1)
  })

  test('el plazo se mide al salir de la cola: con menos de 15 s no sale a la red', async () => {
    const clock = { now: 0 }
    const dl = startDeadline(60_000, () => clock.now)
    const queue = createOdooQueue({ spacingMs: 0 })
    // A slow read ahead in the queue eats 50 s of the request's budget.
    const reader = createOdooCaller({
      queue,
      getEnv: () => ENV,
      fetchFn: async () => {
        clock.now += 50_000
        return json([])
      },
    })
    const { write, requests } = rawWriter({ queue })

    expect(dl.remainingMs()).toBe(60_000)
    const read = reader('sale.order', 'search_read', {})
    const pending = write('sale.order', 'action_confirm', { ids: [912] }, dl).catch((e) => e)
    await read
    const error = await pending
    expect(error).toBeInstanceOf(OdooError)
    expect(error).not.toBeInstanceOf(OdooUncertainWriteError)
    expect(error.message).toBe(SLOW)
    expect(requests).toHaveLength(0)

    // At exactly 15 s left it still goes out, with a 10 s timeout.
    const seen: number[] = []
    const edge = rawWriter({ timeoutSignal: recordTimeout(seen) })
    await edge.write('sale.order', 'action_confirm', { ids: [912] }, fixedDeadline(15_000))
    expect(seen).toEqual([10_000])
  })

  test('el timeout de escritura es min(25 s, restante − 5 s)', async () => {
    expect(writeTimeoutMs(60_000)).toBe(25_000)
    expect(writeTimeoutMs(30_000)).toBe(25_000)
    expect(writeTimeoutMs(22_000)).toBe(17_000)
    expect(writeTimeoutMs(15_000)).toBe(10_000)
    expect(writeTimeoutMs(14_999)).toBeNull()
    expect(writeTimeoutMs(Number.NaN)).toBeNull()

    for (const [remaining, expected] of [
      [60_000, 25_000],
      [22_000, 17_000],
    ] as const) {
      const seen: number[] = []
      const { write } = rawWriter({ timeoutSignal: recordTimeout(seen) })
      await write('sale.order', 'action_confirm', { ids: [912] }, fixedDeadline(remaining))
      expect(seen).toEqual([expected])
    }

    // startDeadline never goes negative and follows its clock.
    let now = 1_000
    const dl = startDeadline(60_000, () => now)
    now += 70_000
    expect(dl.remainingMs()).toBe(0)
  })

  test('timeout, red o 504 → resultado desconocido, sin reintento; 429 → un reintento', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const confirm = { ids: [912] }

    const failures: (Response | Error)[] = [
      new DOMException(`The operation was aborted due to timeout (${WRITE_KEY})`, 'TimeoutError'),
      new TypeError(`fetch failed: bearer ${WRITE_KEY}`),
      new Response('<html>504 Gateway Time-out</html>', { status: 504 }),
      json({ message: 'Service Unavailable' }, 503),
      new Response('<html>Bad Gateway</html>', { status: 502 }),
      new Response('<html>Internal Server Error</html>', { status: 500 }),
      new Response('{"truncated', { status: 200 }),
    ]
    for (const failure of failures) {
      const { write, requests, sleeps } = rawWriter({ responses: [failure] })
      const error = await write('sale.order', 'action_confirm', confirm, fixedDeadline()).catch((e) => e)
      expect(error, String(failure)).toBeInstanceOf(OdooUncertainWriteError)
      expect(error.operation).toBe('sale.order.action_confirm')
      expect(error.message).toContain('Repite exactamente la misma llamada')
      expect(requests).toHaveLength(1)
      expect(sleeps).toEqual([])
      expect(error.message).not.toContain(WRITE_KEY)
    }
    expect(JSON.stringify(logged.mock.calls)).not.toContain(WRITE_KEY)

    // The retry advice follows the operation's row.
    const products = rawWriter({ responses: [new TypeError('fetch failed')] })
    const productError = await products
      .write('product.product', 'create', { vals_list: [{ name: 'X', list_price: 1, type: 'consu', sale_ok: true }] }, fixedDeadline())
      .catch((e) => e)
    expect(productError.retry).toBe('products')
    const wizard = rawWriter({ responses: [new TypeError('fetch failed')] })
    const wizardError = await wizard
      .write('sale.advance.payment.inv', 'create_invoices', { ids: [77], context: SALE_CONTEXT }, fixedDeadline())
      .catch((e) => e)
    expect(wizardError.retry).toBe('invoice')

    // A JSON-2 error body is definitive: Odoo rolled the call back.
    const rejected = rawWriter({
      responses: [json({ message: 'No puedes confirmar una cotización sin líneas.', debug: 'Traceback …' }, 500)],
    })
    const definitive = await rejected.write('sale.order', 'action_confirm', confirm, fixedDeadline()).catch((e) => e)
    expect(definitive).toBeInstanceOf(OdooError)
    expect(definitive).not.toBeInstanceOf(OdooUncertainWriteError)
    expect(definitive.message).toBe('Odoo rechazó sale.order.action_confirm: No puedes confirmar una cotización sin líneas.')

    const forbidden = rawWriter({ responses: [json({ message: 'Acceso denegado' }, 403)] })
    const denied = await forbidden.write('sale.order', 'action_confirm', confirm, fixedDeadline()).catch((e) => e)
    expect(denied).not.toBeInstanceOf(OdooUncertainWriteError)
    expect(denied.status).toBe(403)

    // 429: one retry after Retry-After.
    const limited = rawWriter({ responses: [new Response('slow', { status: 429, headers: { 'retry-after': '2' } }), json(true)] })
    await expect(limited.write('sale.order', 'action_confirm', confirm, fixedDeadline())).resolves.toBe(true)
    expect(limited.sleeps).toEqual([2000])
    expect(limited.requests).toHaveLength(2)

    // A second 429 is a plain refusal: nothing was written.
    const twice = rawWriter({ responses: [new Response('', { status: 429 }), new Response('', { status: 429 })] })
    const twiceError = await twice.write('sale.order', 'action_confirm', confirm, fixedDeadline()).catch((e) => e)
    expect(twiceError).not.toBeInstanceOf(OdooUncertainWriteError)
    expect(twiceError.status).toBe(429)
    expect(twice.requests).toHaveLength(2)

    // A long Retry-After fails right away instead of holding the shared queue.
    const long = rawWriter({ responses: [new Response('', { status: 429, headers: { 'retry-after': '60' } })] })
    const longError = await long.write('sale.order', 'action_confirm', confirm, fixedDeadline()).catch((e) => e)
    expect(longError.message).toContain('Odoo pidió esperar 60 s')
    expect(long.sleeps).toEqual([])
    expect(long.requests).toHaveLength(1)

    // The deadline is checked again before the retry.
    const clock = { now: 0 }
    const late = rawWriter({ clock, responses: [new Response('', { status: 429, headers: { 'retry-after': '5' } })] })
    const lateError = await late
      .write('sale.order', 'action_confirm', confirm, startDeadline(19_000, () => clock.now))
      .catch((e) => e)
    expect(lateError.message).toBe(SLOW)
    expect(late.requests).toHaveLength(1)
  })

  test('401 → la llave venció o la revocaron, nada escrito', async () => {
    const { write, requests } = rawWriter({ responses: [json({ message: 'Invalid apikey' }, 401)] })
    const error = await write('sale.order', 'action_confirm', { ids: [912] }, fixedDeadline()).catch((e) => e)
    expect(error).toBeInstanceOf(OdooError)
    expect(error).not.toBeInstanceOf(OdooUncertainWriteError)
    expect(error.status).toBe(401)
    expect(error.message).toBe(
      'La llave de escritura de Odoo (ODOO_WRITE_API_KEY) ya no sirve: venció o la revocaron. No se escribió nada.',
    )
    expect(requests).toHaveLength(1)
  })

  test('una redirección no se sigue: la escritura y la llave no viajan a otro lado', async () => {
    for (const response of [
      new Response(null, { status: 307, headers: { location: 'https://otro.test/json/2/sale.order/action_confirm' } }),
      new Response(null, { status: 301, headers: { location: 'http://odoo.test/' } }),
      Response.error(),
    ]) {
      const { write, requests } = rawWriter({ responses: [response] })
      const error = await write('sale.order', 'action_confirm', { ids: [912] }, fixedDeadline()).catch((e) => e)
      expect(error, String(response.status)).toBeInstanceOf(OdooError)
      expect(error).not.toBeInstanceOf(OdooUncertainWriteError)
      expect(error.message).toContain('redirección')
      expect(error.message).toContain('no se escribió nada')
      expect(requests).toHaveLength(1)
      expect(requests[0].redirect).toBe('manual')
    }
  })

  test('una petición que no se puede armar no se envió: error seguro, sin la llave', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const badKey = `${WRITE_KEY}\nX-Evil: 1`
    const { write, requests } = rawWriter({ env: { ...ENV, apiKey: badKey } })
    const error = await write('sale.order', 'action_confirm', { ids: [912] }, fixedDeadline()).catch((e) => e)
    expect(error).toBeInstanceOf(OdooError)
    expect(error).not.toBeInstanceOf(OdooUncertainWriteError)
    expect(error.message).toContain('no se envió nada')
    expect(requests).toHaveLength(0)
    expect(JSON.stringify([error.message, logged.mock.calls])).not.toContain(WRITE_KEY)
  })

  test('el catálogo corre antes de la cola, sobre lo que de verdad se envía', async () => {
    const getEnv = vi.fn(() => ENV)
    const fetchFn = vi.fn(async () => json(true))
    const write = createOdooRawWriter({ getEnv, fetchFn, queue: createOdooQueue({ spacingMs: 60_000 }) })
    await expect(write('account.move', 'action_post', { ids: [1] }, fixedDeadline())).rejects.toThrow(/no escribe en/)
    // toJSON would smuggle a context past a check made on the object instead of on the body.
    const sneaky = { ids: [912], toJSON: () => ({ ids: [912], context: { send_email: true } }) }
    await expect(write('sale.order', 'action_confirm', sneaky, fixedDeadline())).rejects.toThrow(/"send_email"/)
    expect(getEnv).not.toHaveBeenCalled()
    expect(fetchFn).not.toHaveBeenCalled()

    // Refused writes took no slot: with 60 s spacing, this one still goes out at once.
    await expect(write('sale.order', 'action_confirm', { ids: [912] }, fixedDeadline())).resolves.toBe(true)
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  test('la factura usa la misma llave en el asistente y en create_invoices', async () => {
    const { write, requests } = rawWriter({ responses: [json([77]), json(true)] })
    await createOdooWriter(write, { log: () => undefined }).createDraftInvoice(testAdminProof(), 912, fixedDeadline())
    expect(requests.map((r) => r.url)).toEqual([
      'https://odoo.test/json/2/sale.advance.payment.inv/create',
      'https://odoo.test/json/2/sale.advance.payment.inv/create_invoices',
    ])
    expect(requests.map((r) => r.headers.get('authorization'))).toEqual([`bearer ${WRITE_KEY}`, `bearer ${WRITE_KEY}`])
  })
})

describe('llave de escritura (#144)', () => {
  test('sin ODOO_WRITE_API_KEY la escritura está deshabilitada y no cae a ODOO_API_KEY', () => {
    vi.stubEnv('ODOO_URL', 'https://odoo.test/')
    vi.stubEnv('ODOO_API_KEY', 'read-key')
    vi.stubEnv('ODOO_DB', '')
    vi.stubEnv('ODOO_WRITE_API_KEY', '')
    expect(isOdooWriteConfigured()).toBe(false)
    expect(() => odooWriteEnv()).toThrow(
      'La escritura en Odoo está deshabilitada en este servidor (falta ODOO_WRITE_API_KEY).',
    )

    vi.stubEnv('ODOO_WRITE_API_KEY', `  ${WRITE_KEY}\n`)
    expect(isOdooWriteConfigured()).toBe(true)
    expect(odooWriteEnv()).toEqual({ url: 'https://odoo.test', apiKey: WRITE_KEY, db: null })

    vi.stubEnv('ODOO_WRITE_API_KEY', `${WRITE_KEY}\r\nX: 1`)
    let message = ''
    try {
      odooWriteEnv()
    } catch (e) {
      message = (e as Error).message
    }
    expect(message).toContain('caracteres no válidos')
    expect(message).not.toContain(WRITE_KEY)

    vi.stubEnv('ODOO_WRITE_API_KEY', WRITE_KEY)
    vi.stubEnv('ODOO_URL', '')
    expect(isOdooWriteConfigured()).toBe(false)
    expect(() => odooWriteEnv()).toThrow(/falta ODOO_URL/)
  })

  test('la llave de escritura solo viaja por https y al origen exacto', () => {
    vi.stubEnv('ODOO_WRITE_API_KEY', WRITE_KEY)
    vi.stubEnv('ODOO_DB', '')
    for (const url of [
      'http://odoo.test',
      'https://odoo.test/odoo',
      'https://odoo.test/?db=x',
      'https://admin:secret@odoo.test',
      'odoo.test',
      'ftp://odoo.test',
    ]) {
      vi.stubEnv('ODOO_URL', url)
      expect(isOdooWriteConfigured(), url).toBe(false)
      let message = ''
      try {
        odooWriteEnv()
      } catch (e) {
        message = (e as Error).message
      }
      expect(message, url).toContain('solo el origen con https')
      expect(message).not.toContain(WRITE_KEY)
      expect(message).not.toContain('secret')
    }
    for (const url of ['https://odoo.test', 'https://odoo.test/', ' https://ODOO.test// ']) {
      vi.stubEnv('ODOO_URL', url)
      expect(isOdooWriteConfigured(), url).toBe(true)
      expect(odooWriteEnv().url, url).toBe('https://odoo.test')
    }
  })

  test('el presupuesto deja margen bajo el maxDuration de las rutas del MCP', () => {
    // Auth and the live-admin read run before the tool starts the clock: the budget is smaller.
    for (const file of ['src/app/api/[transport]/route.ts', 'src/app/api/odoo/[transport]/route.ts']) {
      const segment = /export const maxDuration = (\d+)/.exec(readFileSync(join(process.cwd(), file), 'utf8'))
      expect(Number(segment?.[1]), file).toBe(MCP_MAX_DURATION_S)
    }
    expect(REQUEST_BUDGET_MS + PRE_TOOL_HEADROOM_MS).toBeLessThanOrEqual(MCP_MAX_DURATION_S * 1000)

    let now = 0
    const dl = startDeadline(undefined, () => now)
    expect(dl.remainingMs()).toBe(REQUEST_BUDGET_MS)
    now += REQUEST_BUDGET_MS
    expect(dl.remainingMs()).toBe(0)
  })

  test('importar el escritor sin ODOO_WRITE_API_KEY no truena; sin ella no sale a la red', async () => {
    vi.stubEnv('ODOO_URL', 'https://odoo.test')
    vi.stubEnv('ODOO_API_KEY', 'read-key')
    vi.stubEnv('ODOO_WRITE_API_KEY', undefined)
    const fetchSpy = vi.fn<typeof fetch>(async () => json(true))
    vi.stubGlobal('fetch', fetchSpy)
    vi.spyOn(console, 'info').mockImplementation(() => undefined)

    vi.resetModules()
    const writerModule = await import('@/lib/odoo/writer')
    const guard = await import('@/lib/odoo/write-guard')
    const tokens = await import('@/lib/odoo/preview-token')
    const deadline = await import('@/lib/odoo/deadline')
    const proof = guard.issueAdminProof({ userId: 'admin-1', displayName: 'Ana Admin' })
    // Grants from the fresh module graph: the writer only knows the ones its own module minted.
    const grantFor: GrantFor = (kind) => testPreviewGrant({ kind }, { tokens, guard })

    for (const [name, run] of everyOperation(writerModule.odooWriter, proof, deadline.startDeadline(), grantFor)) {
      await expect(run(), name).rejects.toThrow('La escritura en Odoo está deshabilitada en este servidor (falta ODOO_WRITE_API_KEY).')
    }
    expect(fetchSpy).not.toHaveBeenCalled()

    // Switched on, it signs with the WRITE key, never the read one.
    vi.stubEnv('ODOO_WRITE_API_KEY', WRITE_KEY)
    await writerModule.odooWriter.confirmSale(proof, grantFor('confirmar'), 912, deadline.startDeadline())
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const sent = fetchSpy.mock.calls[0][0] as Request
    expect(sent.url).toBe('https://odoo.test/json/2/sale.order/action_confirm')
    expect(sent.headers.get('authorization')).toBe(`bearer ${WRITE_KEY}`)
  })

  test('en producción el lector y el escritor salen por la misma cola, cada uno con su llave', async () => {
    vi.stubEnv('ODOO_URL', 'https://odoo.test')
    vi.stubEnv('ODOO_API_KEY', 'read-key')
    vi.stubEnv('ODOO_WRITE_API_KEY', WRITE_KEY)
    vi.spyOn(console, 'info').mockImplementation(() => undefined)

    vi.resetModules()
    const client = await import('@/lib/odoo/client')
    const writerModule = await import('@/lib/odoo/writer')
    const guard = await import('@/lib/odoo/write-guard')
    const tokens = await import('@/lib/odoo/preview-token')
    const deadline = await import('@/lib/odoo/deadline')

    vi.useFakeTimers({ now: NOW })
    const sent: { auth: string | null; at: number }[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init)
        sent.push({ auth: request.headers.get('authorization'), at: Date.now() })
        return json(input instanceof Request ? true : 3)
      }),
    )
    const proof = guard.issueAdminProof({ userId: 'admin-1', displayName: 'Ana Admin' })
    const outcome = Promise.all([
      client.callOdoo('sale.order', 'search_count', { domain: [] }),
      writerModule.odooWriter.confirmSale(proof, testPreviewGrant({ kind: 'confirmar' }, { tokens, guard }), 912, deadline.startDeadline()),
    ]).then(
      () => 'ok',
      (error: unknown) => error,
    )
    await vi.advanceTimersByTimeAsync(5_000)
    expect(await outcome).toBe('ok')

    expect(sent.map((s) => s.auth)).toEqual(['bearer read-key', `bearer ${WRITE_KEY}`])
    // Separate queues would have sent both at once; the shared one spaces them by 1.1 s.
    expect(sent[1].at - sent[0].at).toBeGreaterThanOrEqual(1_100)
  })
})

describe('helpers de prueba (#144)', () => {
  test('throwingWriter falla en cualquier operación y cuenta los intentos', async () => {
    const { writer, attempts } = throwingWriter()
    for (const [name, run] of everyOperation(writer, testAdminProof(), fixedDeadline())) {
      await expect(run(), name).rejects.toThrow(/no se debía escribir/)
    }
    expect(attempts).toHaveLength(6)
  })

  test('fakeRawWriter aplica el catálogo real', async () => {
    const { raw, calls } = fakeRawWriter()
    await expect(raw('sale.order', 'unlink', { ids: [912] }, fixedDeadline())).rejects.toThrow(/prohibido/)
    await expect(raw('sale.order', 'action_confirm', { ids: [912] }, fixedDeadline(30_000))).resolves.toBe(true)
    expect(calls.map((c) => [c.method, c.remainingMs])).toEqual([
      ['unlink', 60_000],
      ['action_confirm', 30_000],
    ])
  })

  test('fakeRawWriter valida la copia JSON, igual que producción', async () => {
    // An optional key left undefined vanishes on the wire: both paths must accept it.
    const note = { display_type: 'line_note', name: 'Nota', sequence: 10, product_id: undefined }
    const payload = { ids: [912], vals: { order_line: [[0, 0, note]] } }
    const fake = fakeRawWriter()
    await expect(fake.raw('sale.order', 'write', payload, fixedDeadline())).resolves.toBe(true)
    expect(JSON.stringify(fake.calls[0].payload)).not.toContain('product_id')
    const { write } = rawWriter()
    await expect(write('sale.order', 'write', payload, fixedDeadline())).resolves.toBe(true)

    // And toJSON is seen the same way production sends it.
    const sneaky = { ids: [912], toJSON: () => ({ ids: [912], context: { send_email: true } }) }
    await expect(fake.raw('sale.order', 'action_confirm', sneaky, fixedDeadline())).rejects.toThrow(/"send_email"/)
  })
})
