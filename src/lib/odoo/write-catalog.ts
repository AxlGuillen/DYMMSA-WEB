/**
 * The only writes the assistant may send to Odoo (#144, ADR-040): six model.method rows with
 * strict payloads. The deny list runs first and wins over any future allowlist row.
 */

import { z } from 'zod'
import { isRealDate } from '@/lib/month'
import { OdooError, type UncertainRetry } from './client'

export const ORIGIN_PREFIX = 'Asistente DYMMSA · '

const MARKER_KEY = /^[0-9a-f]{10}$/
const ORIGIN = /^Asistente DYMMSA · [0-9a-f]{10}$/

/** The idempotency marker comes from the signed preview key, never from the content (ADR-040). */
export function originMarker(k10: string): string {
  if (!MARKER_KEY.test(k10)) throw new OdooError('Clave de vista previa mal formada: no escribí nada.')
  return `${ORIGIN_PREFIX}${k10}`
}

const recordId = z.number().int().positive()
const sequence = z.number().int().min(0).max(1_000_000)
const isoDate = z.string().refine((value) => isRealDate(value), 'fecha inválida')
const quantity = z.number().gt(0).max(100_000)
const unitPrice = z.number().min(0).max(10_000_000)
const discount = z.number().min(0).max(100)
const lineText = z.string().min(1).max(300)

const productLine = z.strictObject({
  product_id: recordId,
  product_uom_qty: quantity,
  price_unit: unitPrice,
  discount: discount.optional(),
  sequence,
})
const displayLine = z.strictObject({
  display_type: z.enum(['line_note', 'line_section']),
  name: lineText,
  sequence,
})
const saleLine = z.union([productLine, displayLine])

// v19 recomputes price_unit when the quantity changes: the three always travel together.
const productLineUpdate = z.strictObject({
  product_uom_qty: quantity,
  price_unit: unitPrice,
  discount,
  sequence: sequence.optional(),
})
const displayLineUpdate = z
  .strictObject({ name: lineText.optional(), sequence: sequence.optional() })
  .refine((v) => v.name !== undefined || v.sequence !== undefined, 'sin cambios')
const saleLineUpdate = z.union([productLineUpdate, displayLineUpdate])

/** What an existing line is, as Odoo reread it: display_type false = product. */
export type SaleLineKind = 'product' | 'display'

const LINE_UPDATE_BY_KIND: Readonly<Record<SaleLineKind, { schema: z.ZodType; what: string; allows: string }>> =
  Object.freeze({
    product: {
      schema: productLineUpdate,
      what: 'de producto',
      allows: 'cantidad, precio y descuento juntos (y la secuencia, si cambia)',
    },
    display: { schema: displayLineUpdate, what: 'una nota o sección', allows: 'solo su texto o su secuencia' },
  })

/** The catalog alone can't tell a product line from a note: the facade checks each [1] by its kind. */
export function assertLineUpdateFits(kind: SaleLineKind, lineId: number, value: unknown): void {
  const rule = LINE_UPDATE_BY_KIND[kind]
  if (!rule.schema.safeParse(value).success) {
    throw new OdooError(`La línea ${lineId} es ${rule.what}: un cambio lleva ${rule.allows}. No escribí nada.`)
  }
}

const addLine = z.tuple([z.literal(0), z.literal(0), saleLine])
const updateLine = z.tuple([z.literal(1), recordId, saleLineUpdate])
const removeLine = z.tuple([z.literal(2), recordId, z.literal(0)])

const saleOrderCreateVals = z.strictObject({
  partner_id: recordId,
  origin: z.string().regex(ORIGIN),
  internal_note: z.string().min(1).max(1_000),
  validity_date: isoDate.optional(),
  order_line: z.array(addLine).min(1).max(80),
})

// Owner notes pasted from mail or Word keep inline styles: a tight cap would freeze every edit.
const INTERNAL_NOTE_WRITE_MAX = 500_000

/** Line commands one sale.order.write may carry (adds + updates + removals). */
export const MAX_LINE_COMMANDS = 200

const saleOrderWriteVals = z
  .strictObject({
    order_line: z.array(z.union([addLine, updateLine, removeLine])).min(1).max(MAX_LINE_COMMANDS).optional(),
    validity_date: isoDate.optional(),
    internal_note: z.string().min(1).max(INTERNAL_NOTE_WRITE_MAX).optional(),
  })
  .refine(
    (v) => v.order_line !== undefined || v.validity_date !== undefined || v.internal_note !== undefined,
    'sin cambios',
  )

/** Exported so the preview blocks what the writer would refuse after the admin's click (#144). */
export const PRODUCT_NAME_MAX = 300
/** ETM codes are 9 digits; default_code may list several, comma separated. */
export const ETM_CODE_LIST = /^\d{9}(, ?\d{9})*$/

// No invoice_policy, taxes, uom, category, routes nor active: the instance defaults apply (ADR-040).
const productCreateVals = z.strictObject({
  name: z.string().min(1).max(PRODUCT_NAME_MAX),
  default_code: z.string().regex(ETM_CODE_LIST).optional(),
  list_price: z.number().min(0).max(10_000_000),
  type: z.literal('consu'),
  sale_ok: z.literal(true),
  unspsc_code_id: recordId.optional(),
})

// A full regular invoice only: no down payments, amounts nor consolidation.
const invoiceWizardVals = z.strictObject({
  advance_payment_method: z.literal('delivered'),
  sale_order_ids: z.tuple([z.tuple([z.literal(6), z.literal(0), z.array(recordId).length(1)])]),
})

const singleId = z.array(recordId).length(1)

const saleOrderContext = z.strictObject({
  active_model: z.literal('sale.order'),
  active_ids: z.array(recordId).length(1),
  active_id: recordId,
})

export type SaleLineVals = z.infer<typeof saleLine>
export type SaleLineUpdate = z.infer<typeof saleLineUpdate>
export type SaleLineCommand =
  | readonly [0, 0, SaleLineVals]
  | readonly [1, number, SaleLineUpdate]
  | readonly [2, number, 0]
export type ProductCreateVals = z.infer<typeof productCreateVals>

export type WriteOperationName =
  | 'sale.order.create'
  | 'sale.order.write'
  | 'sale.order.action_confirm'
  | 'product.product.create'
  | 'sale.advance.payment.inv.create'
  | 'sale.advance.payment.inv.create_invoices'

export interface WriteOperation {
  readonly model: string
  readonly method: string
  /** How the caller recovers when the outcome is unknown (OdooUncertainWriteError). */
  readonly retry: UncertainRetry
  /** Payload keys besides `context`; all of them are required. */
  readonly keys: readonly string[]
  readonly payload: z.ZodType
  /** 'none' = the payload carries no context; 'sale-order' = exactly the invoice wizard's active_*. */
  readonly context: 'none' | 'sale-order'
  /** What is allowed, for the rejection message. */
  readonly allows: string
}

function operation(row: WriteOperation): WriteOperation {
  return Object.freeze({ ...row, keys: Object.freeze([...row.keys]) })
}

export const ODOO_WRITE_OPERATIONS: Readonly<Record<WriteOperationName, WriteOperation>> = Object.freeze({
  'sale.order.create': operation({
    model: 'sale.order',
    method: 'create',
    retry: 'quotation',
    keys: ['vals_list'],
    payload: z.strictObject({ vals_list: z.array(saleOrderCreateVals).length(1) }),
    context: 'none',
    allows:
      'una cotización con partner_id, origin (el marcador del asistente), internal_note, validity_date y order_line solo con [0, 0, línea de producto, nota o sección]',
  }),
  'sale.order.write': operation({
    model: 'sale.order',
    method: 'write',
    retry: 'quotation',
    keys: ['ids', 'vals'],
    payload: z.strictObject({ ids: singleId, vals: saleOrderWriteVals }),
    context: 'none',
    allows:
      'una venta; vals con order_line ([0, 0, línea], [1, id, cantidad + precio + descuento] o [2, id, 0]), validity_date e internal_note',
  }),
  'sale.order.action_confirm': operation({
    model: 'sale.order',
    method: 'action_confirm',
    retry: 'quotation',
    keys: ['ids'],
    payload: z.strictObject({ ids: singleId }),
    context: 'none',
    allows: 'una sola venta por id, sin contexto',
  }),
  'product.product.create': operation({
    model: 'product.product',
    method: 'create',
    retry: 'products',
    keys: ['vals_list'],
    payload: z.strictObject({ vals_list: z.array(productCreateVals).min(1).max(40) }),
    context: 'none',
    allows: "de 1 a 40 bienes con name, default_code (ETM), list_price, type 'consu', sale_ok true y unspsc_code_id",
  }),
  'sale.advance.payment.inv.create': operation({
    model: 'sale.advance.payment.inv',
    method: 'create',
    retry: 'invoice',
    keys: ['vals_list'],
    payload: z.strictObject({ vals_list: z.array(invoiceWizardVals).length(1) }),
    context: 'sale-order',
    allows: "advance_payment_method 'delivered' y sale_order_ids [[6, 0, [id]]] de una sola venta",
  }),
  'sale.advance.payment.inv.create_invoices': operation({
    model: 'sale.advance.payment.inv',
    method: 'create_invoices',
    retry: 'invoice',
    keys: ['ids'],
    payload: z.strictObject({ ids: singleId }),
    context: 'sale-order',
    allows: 'el id del asistente de factura recién creado',
  }),
})

// The guard reads a private copy: the export is frozen, but nothing here depends on it.
const OPERATIONS: ReadonlyMap<string, WriteOperation> = new Map(Object.entries(ODOO_WRITE_OPERATIONS))

const ALLOWED_SUMMARY = `Solo se permite: ${[...OPERATIONS.keys()].join(', ')}.`

// "prefix*" = the model and every model under it.
const DENIED_MODELS = [
  'account*',
  'l10n_mx*',
  'res.partner*',
  'res.users*',
  'stock.*',
  'mail.*',
  'ir.*',
  'base.automation*',
] as const

const DENIED_METHOD =
  /^_|post|send|edi|cfdi|stamp|sign|unlink|copy|cancel|draft|validate|message_|name_create|web_|import|toggle_active|archive/i

const DENIED_VALS_KEY = /^(l10n_mx|x_studio)/i

const DENIED_CONTEXT_KEY =
  /^(default_|force_|mail_)|^(send_email|tracking_disable|active_test|allowed_company_ids|check_move_validity)$/i

/** Deeper than any real payload: past it the shape is refused instead of walked. */
const MAX_PAYLOAD_DEPTH = 12

function isDeniedModel(model: string): boolean {
  return DENIED_MODELS.some((rule) =>
    rule.endsWith('*') ? model.startsWith(rule.slice(0, -1)) : model === rule,
  )
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function deniedValsKey(value: unknown, depth: number): string | null {
  if (depth > MAX_PAYLOAD_DEPTH) {
    throw new OdooError(`Odoo: la escritura trae datos demasiado anidados. ${ALLOWED_SUMMARY}`)
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = deniedValsKey(item, depth + 1)
      if (found) return found
    }
  } else if (isPlainObject(value)) {
    for (const [key, item] of Object.entries(value)) {
      if (DENIED_VALS_KEY.test(key)) return key
      const found = deniedValsKey(item, depth + 1)
      if (found) return found
    }
  }
  return null
}

function issuePath(path: readonly PropertyKey[]): string {
  return path.reduce<string>(
    (acc, key) => (typeof key === 'number' ? `${acc}[${key}]` : acc ? `${acc}.${String(key)}` : String(key)),
    '',
  )
}

function issueDetail(issue: z.ZodError['issues'][number]): string {
  const at = issuePath(issue.path)
  const where = at ? ` en ${at}` : ''
  if (issue.code === 'unrecognized_keys') {
    return `campo no permitido${where}: ${issue.keys.map((k) => `"${k}"`).join(', ')}`
  }
  if (issue.code === 'invalid_union') return `forma no permitida${where}`
  return `valor no permitido${where}`
}

function assertSaleOrderContext(op: string, row: WriteOperation, payload: Record<string, unknown>): void {
  const recipe = `El contexto de ${op} lo arma el servidor: exactamente { active_model: 'sale.order', active_ids: [id], active_id: id } con el id de la venta.`
  const parsed = saleOrderContext.safeParse(payload.context)
  if (!parsed.success) throw new OdooError(`Odoo: ${recipe}`)
  const { active_ids, active_id } = parsed.data
  if (active_ids[0] !== active_id) throw new OdooError(`Odoo: ${recipe}`)
  if (row.method === 'create') {
    // Already validated by the payload schema: [[6, 0, [saleId]]].
    const saleIds = (payload.vals_list as { sale_order_ids: [[6, 0, number[]]] }[])[0].sale_order_ids[0][2]
    if (saleIds[0] !== active_id) throw new OdooError(`Odoo: ${recipe}`)
  }
}

/**
 * Deny list → allowlist → payload keys → schema → context; each refusal says what IS allowed.
 * Returns the matched row so the transport knows how an uncertain outcome is retried.
 */
export function assertWriteAllowed(model: string, method: string, payload: unknown): WriteOperation {
  const op = `${model}.${method}`

  if (isDeniedModel(model)) {
    throw new OdooError(
      `Odoo: el asistente no escribe en "${model}" (facturas, pagos, timbrado, clientes, usuarios, inventario, correo ni configuración). ${ALLOWED_SUMMARY}`,
    )
  }
  if (DENIED_METHOD.test(method)) {
    throw new OdooError(
      `Odoo: "${op}" está prohibido para el asistente (publicar, enviar, timbrar, firmar, borrar, copiar, cancelar, regresar a borrador o validar). ${ALLOWED_SUMMARY}`,
    )
  }
  if (!isPlainObject(payload)) throw new OdooError(`Odoo: la escritura ${op} no trae un payload válido.`)
  const deniedKey = deniedValsKey(payload, 0)
  if (deniedKey) {
    throw new OdooError(
      `Odoo: el campo "${deniedKey}" no se escribe desde el asistente (los l10n_mx_* son del timbrado y los x_studio_* de Studio). ${ALLOWED_SUMMARY}`,
    )
  }
  if (isPlainObject(payload.context)) {
    const deniedContext = Object.keys(payload.context).find((key) => DENIED_CONTEXT_KEY.test(key))
    if (deniedContext) {
      throw new OdooError(
        `Odoo: el contexto "${deniedContext}" está prohibido (correos, valores por defecto, forzar o apagar validaciones). El contexto lo arma el servidor.`,
      )
    }
  }

  const row = OPERATIONS.get(op)
  if (!row || row.model !== model || row.method !== method) {
    throw new OdooError(`Odoo: "${op}" no está entre las escrituras permitidas. ${ALLOWED_SUMMARY}`)
  }

  const { context, ...rest } = payload
  if (row.context === 'none' && context !== undefined) {
    throw new OdooError(`Odoo: ${op} no lleva contexto; el servidor nunca lo manda en esta operación.`)
  }
  for (const key of Object.keys(rest)) {
    if (!row.keys.includes(key)) {
      throw new OdooError(`Odoo: ${op} no acepta "${key}"; lleva ${row.keys.join(' y ')}. Se permite: ${row.allows}.`)
    }
  }
  for (const key of row.keys) {
    if (!(key in rest)) throw new OdooError(`Odoo: a ${op} le falta "${key}". Se permite: ${row.allows}.`)
  }

  const parsed = row.payload.safeParse(rest)
  if (!parsed.success) {
    throw new OdooError(`Odoo: ${op} rechazado (${issueDetail(parsed.error.issues[0])}). Se permite: ${row.allows}.`)
  }

  if (row.context === 'sale-order') assertSaleOrderContext(op, row, payload)
  return row
}
