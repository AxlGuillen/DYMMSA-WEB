/** Odoo write allowlist and deny list (#144, ADR-040): pure, no network. */

import { describe, test, expect } from 'vitest'
import { OdooError } from '@/lib/odoo/client'
import {
  assertLineUpdateFits,
  assertWriteAllowed,
  ETM_CODE_LIST,
  ODOO_WRITE_OPERATIONS,
  ORIGIN_PREFIX,
  originMarker,
  PRODUCT_NAME_MAX,
  type WriteOperationName,
} from '@/lib/odoo/write-catalog'

const K10 = '0123456789'
const NOTE =
  '<p>Creada por el asistente (MCP) a petición de Ana Admin · 2026-10-17 22:00 · clave 0123456789 · contenido abcdef0123</p>'
const PRODUCT_LINE = { product_id: 30888, product_uom_qty: 1, price_unit: 1, discount: 0, sequence: 20 }
const NOTE_LINE = { display_type: 'line_note', name: 'PRUEBA #144 — no procesar', sequence: 10 }
const SALE = 912

function createPayload(vals: Record<string, unknown> = {}) {
  return {
    vals_list: [
      {
        partner_id: 1,
        origin: `Asistente DYMMSA · ${K10}`,
        internal_note: NOTE,
        order_line: [
          [0, 0, NOTE_LINE],
          [0, 0, PRODUCT_LINE],
        ],
        ...vals,
      },
    ],
  }
}

const writePayload = (vals: Record<string, unknown>) => ({ ids: [SALE], vals })
const lineCommands = (...commands: unknown[]) => writePayload({ order_line: commands })
const saleContext = (id = SALE) => ({ active_model: 'sale.order', active_ids: [id], active_id: id })

function wizardPayload(vals: Record<string, unknown> = {}, context: unknown = saleContext()) {
  return {
    vals_list: [{ advance_payment_method: 'delivered', sale_order_ids: [[6, 0, [SALE]]], ...vals }],
    context,
  }
}

const PRODUCT = { name: 'ZZTEST144 Producto de prueba del asistente PRUEBA', list_price: 1, type: 'consu', sale_ok: true }
const productsPayload = (product: Record<string, unknown> = {}) => ({ vals_list: [{ ...PRODUCT, ...product }] })

const VALID: Record<WriteOperationName, Record<string, unknown>> = {
  'sale.order.create': createPayload(),
  'sale.order.write': lineCommands([1, 4711, { product_uom_qty: 2, price_unit: 1, discount: 0 }], [2, 4712, 0]),
  'sale.order.action_confirm': { ids: [SALE] },
  'product.product.create': productsPayload({ default_code: '510033153, 510022171', unspsc_code_id: 5432 }),
  'product.product.write': { ids: [16971, 32300], vals: { unspsc_code_id: 5432 } },
  'sale.advance.payment.inv.create': wizardPayload(),
  'sale.advance.payment.inv.create_invoices': { ids: [77], context: saleContext() },
}

const allows = (model: string, method: string, payload: unknown) => () => assertWriteAllowed(model, method, payload)

function rejection(model: string, method: string, payload: unknown): OdooError {
  try {
    assertWriteAllowed(model, method, payload)
  } catch (error) {
    expect(error).toBeInstanceOf(OdooError)
    return error as OdooError
  }
  throw new Error(`${model}.${method} debió rechazarse: ${JSON.stringify(payload)}`)
}

describe('allowlist de escrituras (#144)', () => {
  test('las operaciones permitidas son exactamente las siete aprobadas', () => {
    expect(Object.keys(ODOO_WRITE_OPERATIONS)).toEqual([
      'sale.order.create',
      'sale.order.write',
      'sale.order.action_confirm',
      'product.product.create',
      // The 7th (#154, ADR-040 2026-10-24): only the SAT key of an existing product.
      'product.product.write',
      'sale.advance.payment.inv.create',
      'sale.advance.payment.inv.create_invoices',
    ])
    for (const [name, row] of Object.entries(ODOO_WRITE_OPERATIONS)) {
      expect(`${row.model}.${row.method}`).toBe(name)
      expect(Object.isFrozen(row)).toBe(true)
      expect(Object.isFrozen(row.keys)).toBe(true)
      // Each valid payload passes and hands back its own row.
      expect(assertWriteAllowed(row.model, row.method, VALID[name as WriteOperationName])).toBe(row)
    }
    expect(Object.isFrozen(ODOO_WRITE_OPERATIONS)).toBe(true)

    // How an unknown outcome is retried is fixed per row, never chosen by the caller.
    expect(Object.fromEntries(Object.entries(ODOO_WRITE_OPERATIONS).map(([n, r]) => [n, r.retry]))).toEqual({
      'sale.order.create': 'quotation',
      'sale.order.write': 'quotation',
      'sale.order.action_confirm': 'quotation',
      'product.product.create': 'products',
      'product.product.write': 'sat-keys',
      'sale.advance.payment.inv.create': 'invoice',
      'sale.advance.payment.inv.create_invoices': 'invoice',
    })
  })

  test('la tabla congelada no se puede ampliar en tiempo de ejecución', () => {
    const table = ODOO_WRITE_OPERATIONS as unknown as Record<string, unknown>
    expect(() => {
      table['res.partner.create'] = { ...ODOO_WRITE_OPERATIONS['sale.order.action_confirm'], model: 'res.partner' }
    }).toThrow(TypeError)
    expect(() => {
      ;(ODOO_WRITE_OPERATIONS['sale.order.action_confirm'] as { method: string }).method = 'action_cancel'
    }).toThrow(TypeError)
    expect(rejection('sale.order', 'action_cancel', { ids: [SALE] }).message).toContain('prohibido')
  })

  test('un modelo.método fuera de la lista se rechaza y dice cuáles sí', () => {
    for (const [model, method] of [
      ['sale.order', 'action_quotation_sent'],
      ['sale.order', 'onchange'],
      ['product.template', 'create'],
      ['sale.order.line', 'write'],
      ['sale', 'order.create'],
      ['sale.order/create?', 'x'],
    ]) {
      const error = rejection(model, method, { ids: [SALE] })
      expect(error.message, `${model}.${method}`).toMatch(/no está entre las escrituras permitidas|prohibido/)
      expect(error.message).toContain('Solo se permite: sale.order.create, sale.order.write')
    }
  })
})

describe('lista negra (#144)', () => {
  test('REGLA: nada de publicar, timbrar, enviar, borrar ni crear clientes', () => {
    const forbidden: [string, string][] = [
      ['account.move', 'action_post'],
      ['account.move', 'action_invoice_sent'],
      ['account.move', 'action_send_and_print'],
      ['account.move', 'button_draft'],
      ['account.move', 'create'],
      ['account.move', 'write'],
      ['account.move.line', 'write'],
      ['account.move.send.wizard', 'create'],
      ['account.move.reversal', 'create'],
      ['account.payment', 'create'],
      ['account.payment.register', 'create'],
      ['l10n_mx_edi.document', 'create'],
      ['l10n_mx_edi.document', 'write'],
      ['res.partner', 'create'],
      ['res.partner', 'write'],
      ['res.users', 'write'],
      ['res.users.apikeys', 'create'],
      ['stock.picking', 'button_validate'],
      ['stock.picking', 'write'],
      ['mail.mail', 'create'],
      ['mail.message', 'create'],
      ['ir.config_parameter', 'set_param'],
      ['base.automation', 'create'],
      ['sale.order', 'unlink'],
      ['sale.order', 'copy'],
      ['sale.order', 'action_cancel'],
      ['sale.order', 'action_draft'],
      ['sale.order', 'action_quotation_send'],
      ['sale.order', '_create_invoices'],
      ['sale.order', '_action_confirm'],
      ['sale.order', 'message_post'],
      ['sale.order', 'action_archive'],
      ['sale.order', 'toggle_active'],
      ['sale.order', 'web_save'],
      ['product.product', 'name_create'],
      ['product.product', 'load_import'],
      ['account.move', 'l10n_mx_edi_cfdi_try_send'],
    ]
    for (const [model, method] of forbidden) {
      const error = rejection(model, method, VALID['sale.order.action_confirm'])
      // The deny list answers first: it never reaches the "not in the allowlist" message.
      expect(error.message, `${model}.${method}`).toMatch(/no escribe en|está prohibido/)
      expect(error.message).toContain('Solo se permite')
    }
  })

  test('ninguna operación del catálogo cae en la lista negra', () => {
    for (const [name, row] of Object.entries(ODOO_WRITE_OPERATIONS)) {
      expect(allows(row.model, row.method, VALID[name as WriteOperationName]), name).not.toThrow()
    }
  })

  test('las llaves l10n_mx_* y x_studio_* se rechazan a cualquier profundidad', () => {
    const cases: [string, string, unknown, string][] = [
      ['sale.order', 'create', createPayload({ l10n_mx_edi_usage: 'G03' }), 'l10n_mx_edi_usage'],
      ['sale.order', 'create', createPayload({ x_studio_text_field_8rg_1jscmf3o4: 'PARA:' }), 'x_studio_text_field_8rg_1jscmf3o4'],
      ['sale.order', 'write', writePayload({ L10N_MX_EDI_PAYMENT_POLICY: 'PUE' }), 'L10N_MX_EDI_PAYMENT_POLICY'],
      [
        'sale.order',
        'write',
        lineCommands([0, 0, { ...PRODUCT_LINE, l10n_mx_edi_customs_number: 'X' }]),
        'l10n_mx_edi_customs_number',
      ],
      ['product.product', 'create', productsPayload({ x_studio_marca: 'URREA' }), 'x_studio_marca'],
    ]
    for (const [model, method, payload, key] of cases) {
      const error = rejection(model, method, payload)
      expect(error.message).toContain(`"${key}"`)
      expect(error.message).toContain('timbrado')
    }
  })
})

describe('contexto (#144)', () => {
  test('el contexto lo arma el servidor: se rechazan default_*, send_email y active_ids distintos a sale_order_ids', () => {
    const deniedKeys = [
      'send_email',
      'default_user_id',
      'default_advance_payment_method',
      'force_company',
      'force_email',
      'tracking_disable',
      'mail_create_nosubscribe',
      'mail_notrack',
      'active_test',
      'allowed_company_ids',
      'check_move_validity',
    ]
    for (const key of deniedKeys) {
      expect(rejection('sale.order', 'action_confirm', { ids: [SALE], context: { [key]: true } }).message, key).toContain(
        `"${key}"`,
      )
      expect(rejection('sale.advance.payment.inv', 'create', wizardPayload({}, { ...saleContext(), [key]: 1 })).message).toContain(
        `"${key}"`,
      )
    }

    // Rows without context refuse even an empty one.
    for (const name of ['sale.order.create', 'sale.order.write', 'sale.order.action_confirm', 'product.product.create', 'product.product.write'] as const) {
      const row = ODOO_WRITE_OPERATIONS[name]
      expect(rejection(row.model, row.method, { ...VALID[name], context: {} }).message).toContain('no lleva contexto')
    }

    // The wizard's context is exactly the recipe, with the same sale id everywhere.
    const badWizardContexts: unknown[] = [
      undefined,
      {},
      [],
      'sale.order',
      { ...saleContext(), open_invoices: true },
      { active_model: 'account.move', active_ids: [SALE], active_id: SALE },
      { active_model: 'sale.order', active_ids: [913], active_id: 913 },
      { active_model: 'sale.order', active_ids: [SALE], active_id: 913 },
      { active_model: 'sale.order', active_ids: [SALE, 913], active_id: SALE },
      { active_model: 'sale.order', active_ids: [SALE] },
    ]
    for (const context of badWizardContexts) {
      const payload = { vals_list: wizardPayload().vals_list, ...(context === undefined ? {} : { context }) }
      expect(rejection('sale.advance.payment.inv', 'create', payload).message, JSON.stringify(context)).toMatch(
        /lo arma el servidor|le falta|prohibido/,
      )
    }
    for (const context of [undefined, { active_model: 'sale.order', active_ids: [SALE, 913], active_id: SALE }, { ...saleContext(), open_invoices: true }]) {
      const payload = { ids: [77], ...(context === undefined ? {} : { context }) }
      expect(() => assertWriteAllowed('sale.advance.payment.inv', 'create_invoices', payload)).toThrow(OdooError)
    }
  })
})

describe('payloads (#144)', () => {
  test('comandos x2many: crear solo [0,0,v]; editar [0], [1], [2]; [5], [6] fuera de sale_order_ids se rechazan', () => {
    const update = [1, 4711, { product_uom_qty: 2, price_unit: 1, discount: 0 }]
    for (const command of [update, [2, 4711, 0], [3, 4711, 0], [4, 4711, 0], [5, 0, 0], [6, 0, [4711]]]) {
      expect(() => assertWriteAllowed('sale.order', 'create', createPayload({ order_line: [command] })), JSON.stringify(command)).toThrow(
        OdooError,
      )
    }
    expect(allows('sale.order', 'write', lineCommands([0, 0, PRODUCT_LINE], [0, 0, NOTE_LINE], update, [2, 4712, 0]))).not.toThrow()
    for (const command of [[5, 0, 0], [6, 0, [4711, 4712]], [3, 4711, 0], [4, 4711, 0], [2, 4711], [2, 4711, 1], [1, 0, update[2]], [0, 1, PRODUCT_LINE]]) {
      expect(() => assertWriteAllowed('sale.order', 'write', lineCommands(command)), JSON.stringify(command)).toThrow(OdooError)
    }
    // [6, 0, ids] only exists inside sale_order_ids, and with one sale.
    expect(() =>
      assertWriteAllowed('sale.advance.payment.inv', 'create', wizardPayload({ sale_order_ids: [[4, SALE, 0]] })),
    ).toThrow(OdooError)

    // Sizes: 1..80 lines on create, at least one command on write.
    expect(() => assertWriteAllowed('sale.order', 'create', createPayload({ order_line: [] }))).toThrow(OdooError)
    const eighty = Array.from({ length: 80 }, (_, i) => [0, 0, { ...PRODUCT_LINE, sequence: (i + 1) * 10 }])
    expect(allows('sale.order', 'create', createPayload({ order_line: eighty }))).not.toThrow()
    expect(() =>
      assertWriteAllowed('sale.order', 'create', createPayload({ order_line: [...eighty, [0, 0, PRODUCT_LINE]] })),
    ).toThrow(OdooError)
    expect(() => assertWriteAllowed('sale.order', 'write', lineCommands())).toThrow(OdooError)
  })

  test('un [1] de producto exige cantidad, precio y descuento juntos', () => {
    const rejected = [
      { product_uom_qty: 2 },
      { product_uom_qty: 2, price_unit: 1 },
      { price_unit: 1, discount: 0 },
      { product_uom_qty: 2, discount: 0 },
      { discount: 5 },
      { product_uom_qty: 2, price_unit: 1, discount: 0, name: 'otra' },
      { product_uom_qty: 0, price_unit: 1, discount: 0 },
      { product_uom_qty: 2, price_unit: -1, discount: 0 },
      { product_uom_qty: 2, price_unit: 1, discount: 101 },
      { product_uom_qty: 2, price_unit: 1, discount: 0, product_id: 30889 },
      {},
    ]
    for (const values of rejected) {
      expect(() => assertWriteAllowed('sale.order', 'write', lineCommands([1, 4711, values])), JSON.stringify(values)).toThrow(
        OdooError,
      )
    }
    for (const values of [
      { product_uom_qty: 2, price_unit: 1, discount: 0 },
      { product_uom_qty: 2, price_unit: 1, discount: 0, sequence: 30 },
    ]) {
      expect(allows('sale.order', 'write', lineCommands([1, 4711, values])), JSON.stringify(values)).not.toThrow()
    }
    // The catalog can't know a line's kind, so a note's shape passes here (4713 is a note)...
    for (const values of [{ name: 'Tiempo de entrega: 3 a 5 días hábiles' }, { sequence: 40 }]) {
      expect(allows('sale.order', 'write', lineCommands([1, 4713, values])), JSON.stringify(values)).not.toThrow()
    }

    // ...and the facade checks each [1] against the kind Odoo reread.
    const trio = { product_uom_qty: 2, price_unit: 1, discount: 0 }
    for (const values of [{ name: 'texto libre' }, { sequence: 30 }, { product_uom_qty: 2 }, {}]) {
      expect(() => assertLineUpdateFits('product', 4711, values), JSON.stringify(values)).toThrow(
        'La línea 4711 es de producto: un cambio lleva cantidad, precio y descuento juntos (y la secuencia, si cambia). No escribí nada.',
      )
    }
    for (const values of [trio, { name: '' }, {}, { name: 'x', discount: 0 }]) {
      expect(() => assertLineUpdateFits('display', 4713, values), JSON.stringify(values)).toThrow(
        'La línea 4713 es una nota o sección: un cambio lleva solo su texto o su secuencia. No escribí nada.',
      )
    }
    expect(() => assertLineUpdateFits('product', 4711, { ...trio, sequence: 30 })).not.toThrow()
    expect(() => assertLineUpdateFits('display', 4713, { name: 'Nota', sequence: 5 })).not.toThrow()
  })

  test('campos fuera de lista se rechazan (state, locked, user_id, pricelist_id, plan_id, require_payment, note, client_order_ref, l10n_mx_*, x_studio_*)', () => {
    const fields: Record<string, unknown> = {
      state: 'sale',
      locked: true,
      user_id: 2,
      pricelist_id: 2,
      plan_id: 1,
      require_payment: true,
      note: '<p>Condiciones</p>',
      client_order_ref: 'OC-1',
      date_order: '2026-10-17 10:00:00',
      company_id: 1,
    }
    for (const [field, value] of Object.entries(fields)) {
      expect(rejection('sale.order', 'create', createPayload({ [field]: value })).message, field).toContain(`"${field}"`)
      expect(rejection('sale.order', 'write', writePayload({ [field]: value })).message, field).toContain(`"${field}"`)
    }
    // Header identity can't change on write.
    expect(rejection('sale.order', 'write', writePayload({ partner_id: 17 })).message).toContain('"partner_id"')
    expect(rejection('sale.order', 'write', writePayload({ origin: `Asistente DYMMSA · ${K10}` })).message).toContain('"origin"')
    for (const field of ['l10n_mx_edi_usage', 'l10n_mx_edi_cfdi_to_public', 'x_studio_html_field_55d_1jscmcrp6']) {
      expect(rejection('sale.order', 'create', createPayload({ [field]: 'x' })).message).toContain(`"${field}"`)
    }

    // Lines: only the fields of their shape; taxes and units come from the product.
    for (const extra of [{ tax_ids: [[6, 0, [16]]] }, { product_uom_id: 1 }, { name: 'Otro nombre' }, { technical_price_unit: 0 }]) {
      const line = { ...PRODUCT_LINE, ...extra }
      expect(() => assertWriteAllowed('sale.order', 'create', createPayload({ order_line: [[0, 0, line]] })), JSON.stringify(extra)).toThrow(
        OdooError,
      )
    }
    expect(() =>
      assertWriteAllowed('sale.order', 'create', createPayload({ order_line: [[0, 0, { ...NOTE_LINE, display_type: 'line_subsection' }]] })),
    ).toThrow(OdooError)

    // Products: goods sold with the instance defaults (ADR-040).
    for (const product of [
      { invoice_policy: 'order' },
      { taxes_id: [[6, 0, [16]]] },
      { uom_id: 1 },
      { categ_id: 1 },
      { route_ids: [] },
      { active: false },
      { type: 'service' },
      { sale_ok: false },
      { default_code: 'ABC' },
      { default_code: '51003315' },
      { list_price: -1 },
      { name: '' },
    ]) {
      expect(() => assertWriteAllowed('product.product', 'create', productsPayload(product)), JSON.stringify(product)).toThrow(
        OdooError,
      )
    }
    expect(() =>
      assertWriteAllowed('product.product', 'create', { vals_list: Array.from({ length: 41 }, () => PRODUCT) }),
    ).toThrow(OdooError)
    expect(() => assertWriteAllowed('product.product', 'create', { vals_list: [] })).toThrow(OdooError)
  })

  test('el payload lleva exactamente sus llaves y el rechazo dice qué se permite', () => {
    const extra = rejection('sale.order', 'action_confirm', { ids: [SALE], vals: {} })
    expect(extra.message).toContain('no acepta "vals"')
    expect(extra.message).toContain(ODOO_WRITE_OPERATIONS['sale.order.action_confirm'].allows)
    expect(rejection('sale.order', 'write', { ids: [SALE] }).message).toContain('le falta "vals"')
    expect(rejection('sale.order', 'action_confirm', { ids: [SALE, 913] }).message).toContain('una sola venta')
    expect(rejection('sale.order', 'write', writePayload({})).message).toContain('Se permite')
    for (const payload of [null, [], 'ids', 5]) {
      expect(() => assertWriteAllowed('sale.order', 'action_confirm', payload)).toThrow(OdooError)
    }
    for (const ids of [[0], [-1], [1.5], ['912']]) {
      expect(() => assertWriteAllowed('sale.order', 'action_confirm', { ids })).toThrow(OdooError)
    }
  })

  test('validity_date es una fecha real y internal_note tiene tope', () => {
    expect(allows('sale.order', 'create', createPayload({ validity_date: '2026-11-16' }))).not.toThrow()
    for (const date of ['2026-02-30', '16/11/2026', '2026-11-16T00:00:00']) {
      expect(() => assertWriteAllowed('sale.order', 'create', createPayload({ validity_date: date })), date).toThrow(OdooError)
    }
    expect(() => assertWriteAllowed('sale.order', 'create', createPayload({ internal_note: 'x'.repeat(1001) }))).toThrow(OdooError)
    // On write it carries the owner's own note too: pasted mail keeps inline styles.
    expect(allows('sale.order', 'write', writePayload({ internal_note: 'x'.repeat(500_000) }))).not.toThrow()
    expect(() => assertWriteAllowed('sale.order', 'write', writePayload({ internal_note: 'x'.repeat(500_001) }))).toThrow(OdooError)
  })

  test('los topes del producto se exportan y caben el nombre más largo que arma la vista previa', () => {
    // '<código ≤40> <descripción ≤200> <MARCA ≤40>' = 282 characters at most.
    const longest = `${'C'.repeat(40)} ${'d'.repeat(200)} ${'M'.repeat(40)}`
    expect(longest).toHaveLength(282)
    expect(PRODUCT_NAME_MAX).toBeGreaterThanOrEqual(longest.length)
    expect(allows('product.product', 'create', productsPayload({ name: longest }))).not.toThrow()
    expect(allows('product.product', 'create', productsPayload({ name: 'x'.repeat(PRODUCT_NAME_MAX) }))).not.toThrow()
    expect(() =>
      assertWriteAllowed('product.product', 'create', productsPayload({ name: 'x'.repeat(PRODUCT_NAME_MAX + 1) })),
    ).toThrow(OdooError)

    for (const etm of ['510033153', '510033153, 510022171', '510033153,510022171']) {
      expect(ETM_CODE_LIST.test(etm), etm).toBe(true)
    }
    for (const etm of ['5467', '51003315', '510033153;510022171', '510033153, ', 'ETM 510033153']) {
      expect(ETM_CODE_LIST.test(etm), etm).toBe(false)
    }
  })

  test('la séptima operación solo escribe unspsc_code_id: precio, nombre, impuestos o archivar se rechazan (#154)', () => {
    const satWrite = (vals: Record<string, unknown>, ids: unknown = [16971]) => ({ ids, vals })
    expect(allows('product.product', 'write', satWrite({ unspsc_code_id: 5432 }))).not.toThrow()
    for (const extra of [
      { list_price: 10 },
      { name: 'Otro nombre' },
      { default_code: '510033153' },
      { taxes_id: [[6, 0, [16]]] },
      { type: 'service' },
      { sale_ok: false },
      { invoice_policy: 'order' },
      { uom_id: 1 },
      { categ_id: 1 },
      { active: false },
    ]) {
      const error = rejection('product.product', 'write', satWrite({ unspsc_code_id: 5432, ...extra }))
      expect(error.message, JSON.stringify(extra)).toContain(`campo no permitido en vals: "${Object.keys(extra)[0]}"`)
      expect(error.message).toContain('vals solo con unspsc_code_id')
    }
    for (const vals of [{}, { unspsc_code_id: 0 }, { unspsc_code_id: '5432' }, { unspsc_code_id: false }, { unspsc_code_id: [5432] }]) {
      expect(() => assertWriteAllowed('product.product', 'write', satWrite(vals)), JSON.stringify(vals)).toThrow(OdooError)
    }
    // 1 to 40 products, by id, never a domain nor the template.
    for (const ids of [[], [0], ['16971'], Array.from({ length: 41 }, (_, i) => i + 1)]) {
      expect(() => assertWriteAllowed('product.product', 'write', satWrite({ unspsc_code_id: 5432 }, ids)), JSON.stringify(ids)).toThrow(
        OdooError,
      )
    }
    expect(rejection('product.template', 'write', satWrite({ unspsc_code_id: 5432 })).message).toContain(
      'no está entre las escrituras permitidas',
    )
    expect(rejection('product.product', 'write', { ...satWrite({ unspsc_code_id: 5432 }), context: {} }).message).toContain(
      'no lleva contexto',
    )
  })

  test('la lista negra gana también sobre la séptima operación', () => {
    const studio = rejection('product.product', 'write', { ids: [16971], vals: { unspsc_code_id: 5432, x_studio_marca: 'URREA' } })
    expect(studio.message).toContain('"x_studio_marca"')
    expect(studio.message).toContain('timbrado')
    const stamping = rejection('product.product', 'write', { ids: [16971], vals: { l10n_mx_edi_code_sat: '01010101' } })
    expect(stamping.message).toContain('"l10n_mx_edi_code_sat"')
    for (const method of ['unlink', 'copy', 'toggle_active', 'action_archive', 'write_sat']) {
      expect(() => assertWriteAllowed('product.product', method, { ids: [16971], vals: { unspsc_code_id: 5432 } }), method).toThrow(
        OdooError,
      )
    }
    const forbiddenContext = rejection('product.product', 'write', {
      ids: [16971],
      vals: { unspsc_code_id: 5432 },
      context: { active_test: false },
    })
    expect(forbiddenContext.message).toContain('"active_test"')
  })

  test('el asistente de factura solo acepta delivered y una sola venta', () => {
    for (const vals of [
      { advance_payment_method: 'percentage' },
      { advance_payment_method: 'fixed' },
      { amount: 50 },
      { fixed_amount: 100 },
      { deduct_down_payments: true },
      { consolidated_billing: true },
      { sale_order_ids: [[6, 0, [SALE, 913]]] },
      { sale_order_ids: [[6, 0, []]] },
      { sale_order_ids: [[6, 0, [SALE]], [6, 0, [913]]] },
    ]) {
      expect(() => assertWriteAllowed('sale.advance.payment.inv', 'create', wizardPayload(vals)), JSON.stringify(vals)).toThrow(
        OdooError,
      )
    }
    const two = { ...wizardPayload(), vals_list: [wizardPayload().vals_list[0], wizardPayload().vals_list[0]] }
    expect(() => assertWriteAllowed('sale.advance.payment.inv', 'create', two)).toThrow(OdooError)
    expect(() =>
      assertWriteAllowed('sale.advance.payment.inv', 'create_invoices', { ids: [77, 78], context: saleContext() }),
    ).toThrow(OdooError)
  })

  test('origin solo puede ser el marcador del asistente', () => {
    expect(originMarker(K10)).toBe(`Asistente DYMMSA · ${K10}`)
    expect(originMarker(K10).startsWith(ORIGIN_PREFIX)).toBe(true)
    for (const bad of ['', 'xyz', '012345678', '0123456789a', 'ABCDEF0123', '012345678g']) {
      expect(() => originMarker(bad), bad).toThrow(OdooError)
    }
    for (const origin of [
      'S00912',
      'Asistente DYMMSA · 012345678',
      'Asistente DYMMSA · ABCDEF0123',
      `Asistente DYMMSA · ${K10} `,
      `Asistente DYMMSA - ${K10}`,
      `asistente dymmsa · ${K10}`,
      false,
    ]) {
      expect(() => assertWriteAllowed('sale.order', 'create', createPayload({ origin })), String(origin)).toThrow(OdooError)
    }
    const { origin: _origin, ...withoutOrigin } = createPayload().vals_list[0]
    expect(() => assertWriteAllowed('sale.order', 'create', { vals_list: [withoutOrigin] })).toThrow(OdooError)
  })
})
