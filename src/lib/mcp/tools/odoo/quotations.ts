/**
 * Odoo quotations from the assistant (#144, ADR-040): the preview only reads and signs a key; the
 * save writes exactly what was previewed (create, edit or confirm) and never posts nor stamps.
 */

import { z } from 'zod'
import { todayInMexico } from '@/lib/format'
import { isRealDate } from '@/lib/month'
import { OdooError, type OdooCaller } from '@/lib/odoo/client'
import { startDeadline, type Deadline } from '@/lib/odoo/deadline'
import { escapeLike } from '@/lib/odoo/domains'
import { odooWriteEnv } from '@/lib/odoo/env'
import { idsOf, many2oneId } from '@/lib/odoo/normalize'
import {
  grantPreviewWrite,
  issueProductsAuthorization,
  issueQuotationKey,
  PREVIEW_CHANGED_MESSAGE,
  PREVIEW_KEY_MISSING_MESSAGE,
  PRODUCTS_AUTHORIZATION_META,
  quotationContentHash,
  verifyQuotationKey,
  type QuotationKeyKind,
  type VerifiedQuotationKey,
} from '@/lib/odoo/preview-token'
import {
  assertQuotationLines,
  COMPANY_PARTNER_ID,
  confirmEffects,
  createLineVals,
  currentPreviewLines,
  isEmptyDiff,
  LINE_PRICE_MAX,
  LINE_QTY_MAX,
  linesAsInput,
  listOfLines,
  NOTE_ECHO_MAX,
  planQuotationLines,
  priceDifferences,
  quotationMode,
  SALE_STATE_LABEL,
  unechoableWarnings,
  type CurrentLine,
  type LinePlan,
  type LineRequest,
  type NewProductView,
  type PreviewLine,
  type PriceDifference,
  type ProductForCreation,
} from '@/lib/odoo/quotation-plan'
import { ORIGIN_PREFIX, originMarker } from '@/lib/odoo/write-catalog'
import { noteHasKeyMarker, ownedSaleLines, type OdooNote, type OdooWriter } from '@/lib/odoo/writer'
import type { AdminProof } from '@/lib/odoo/write-guard'
import type { McpContext } from '../../context'
import { requireLiveAdmin, ToolError, withResultMeta, type ResultWithMeta } from '../../shared'
import {
  many2oneName,
  numberOr,
  readSaleLines,
  requireExactSale,
  resolvePartnerForWrite,
  resolveProductsForWrite,
  rowsOf,
  saleFromRow,
  type SaleRecord,
  type WritePartner,
} from './resolve'

export type {
  LineAction,
  NewProductView,
  PreviewLine,
  PreviewProduct,
  PriceDifference,
  ProductForCreation,
  ProductState,
} from '@/lib/odoo/quotation-plan'

// Short descriptions: every character counts twice in the tools/list budget (ADR-034).
export const quotationLine = z.strictObject({
  linea_id: z.number().int().positive().optional().describe('Línea existente (editar): de lineas_como_entrada'),
  producto_id: z.number().int().positive().optional().describe('Id del producto en Odoo (desempata)'),
  codigo: z.string().max(40).optional().describe('Código de modelo: el inicio del nombre en Odoo'),
  etm: z.string().max(60).optional().describe('ETM (default_code)'),
  marca: z.string().max(40).optional(),
  descripcion: z.string().max(200).optional().describe('Solo para dar de alta un producto que falta'),
  clave_sat: z.string().regex(/^\d{8}$/, 'clave SAT de 8 dígitos').optional().describe('Solo producto nuevo'),
  cantidad: z.number().positive().max(LINE_QTY_MAX).optional(),
  precio: z.number().min(0).max(LINE_PRICE_MAX).optional().describe('Unitario sin IVA; obligatorio'),
  descuento: z.number().min(0).max(100).optional().describe('%'),
  nota: z.string().min(1).max(NOTE_ECHO_MAX).optional().describe('Línea de nota (nueva: hasta 300)'),
  seccion: z.string().min(1).max(NOTE_ECHO_MAX).optional().describe('Línea de sección (nueva: hasta 300)'),
})

export type QuotationLineInput = z.infer<typeof quotationLine>

const folio = z.string().regex(/^S\d{5,}$/i, 'folio de venta de Odoo, ej. S00912')
const isoDate = z.string().refine((value) => isRealDate(value), 'fecha inválida (YYYY-MM-DD)')

export const previewQuotationShape = {
  cliente: z.string().min(1).max(120).optional().describe('Crear: nombre, RFC o #id del cliente'),
  folio: folio.optional().describe('Cotización existente: revisar (solo folio) o editar (con lineas)'),
  lineas: z.array(quotationLine).min(1).max(80).optional().describe('La lista COMPLETA deseada'),
  vigencia: isoDate.optional().describe('Vence el (YYYY-MM-DD)'),
}

export const saveQuotationShape = {
  ...previewQuotationShape,
  confirmar: z.literal(true).optional().describe('Confirmar como venta: solo folio, sin lineas'),
  clave: z.string().min(1).max(4000).describe('La clave de la vista previa'),
}

const previewSchema = z.strictObject(previewQuotationShape)
const saveSchema = z.strictObject(saveQuotationShape)

export type PreviewQuotationInput = z.infer<typeof previewSchema>
export type SaveQuotationInput = z.infer<typeof saveSchema>

/** What the handler injects: the read-only caller and the closed writer facade. */
export interface OdooQuotationDeps {
  readonly reader: OdooCaller
  readonly writer: OdooWriter
}

type ToolContext = Pick<McpContext, 'db' | 'userId' | 'role'>

export interface PreviewClient {
  readonly id: number
  readonly nombre: string
  readonly rfc: string | null
  readonly es_la_empresa: boolean
}

export interface PreviewQuote {
  readonly id: number
  readonly folio: string
  readonly estado: string
  readonly subtotal: number
  readonly total: number
  readonly moneda: string | null
  readonly vigencia: string | null
}

/** odoo_preview_quotation's result; the view (src/mcp-views/odoo-quotation) renders it. */
export interface QuotationPreview {
  readonly modo: 'crear' | 'editar' | 'revisar'
  readonly cliente: PreviewClient
  readonly cotizacion: PreviewQuote | null
  readonly lineas: readonly PreviewLine[]
  /** Review only: the current lines with their linea_id, to start an edit from. */
  readonly lineas_como_entrada?: readonly LineRequest[]
  readonly productos_nuevos: readonly NewProductView[]
  /** Exactly what the view sends to odoo_save_product and the authorization in _meta signs. */
  readonly productos_para_alta: readonly ProductForCreation[]
  readonly subtotal: number
  readonly moneda: string
  readonly impuestos: string
  readonly bloqueos: readonly string[]
  readonly avisos: readonly string[]
  readonly al_confirmar: string
  readonly puede_guardar: boolean
  readonly clave: string | null
  readonly vence: string | null
  readonly siguiente_paso: string
}

export interface SaleView {
  readonly folio: string | null
  readonly id: number
  readonly estado: string
  readonly subtotal: number | null
  readonly iva: number | null
  readonly total: number | null
  readonly moneda: string | null
  readonly cliente: string | null
}

export interface QuotationSaveResult {
  readonly cotizacion: SaleView
  readonly ya_existia?: true
  readonly quitadas?: readonly string[]
  readonly precios_distintos?: readonly PriceDifference[]
  readonly aviso_rastro?: string
  readonly aviso_relectura?: string
  readonly avisos?: readonly string[]
  readonly confirmacion?: { readonly entregas: readonly string[]; readonly facturable_ya: number }
  readonly siguiente_paso: string
}

const TAX_NOTE = 'Montos sin IVA: los impuestos los calcula Odoo al guardar.'
const NOTHING_SAVED = 'Nada se ha guardado.'

/** 'debe ser al menos 0' / 'lleva hasta 80 líneas'. */
function boundReason(origin: string, limit: number | bigint, side: 'min' | 'max', inclusive: boolean): string {
  const count = (one: string, many: string) => `${limit} ${limit === 1 ? one : many}`
  if (origin === 'string') return `lleva ${side === 'min' ? 'al menos' : 'hasta'} ${count('carácter', 'caracteres')}`
  if (origin === 'array') return `lleva ${side === 'min' ? 'al menos' : 'hasta'} ${count('línea', 'líneas')}`
  if (side === 'min') return `debe ser ${inclusive ? 'al menos' : 'mayor que'} ${limit}`
  return `debe ser ${inclusive ? 'a lo más' : 'menor que'} ${limit}`
}

/** zod's own messages are English: the reasons the model can act on, in Spanish. */
function issueReason(issue: z.core.$ZodIssue): string | null {
  if (issue.code === 'custom' || issue.code === 'invalid_format') return issue.message
  if (issue.code === 'too_small') return boundReason(issue.origin, issue.minimum, 'min', issue.inclusive !== false)
  if (issue.code === 'too_big') return boundReason(issue.origin, issue.maximum, 'max', issue.inclusive !== false)
  return null
}

/** The SDK already parsed with zod; this keeps direct calls (tests, scripts) to the same contract. */
function parseInput<S extends z.ZodType>(schema: S, raw: unknown): z.infer<S> {
  const parsed = schema.safeParse(raw)
  if (parsed.success) return parsed.data
  const issue = parsed.error.issues[0]
  const at = issue.path.length ? ` en ${issue.path.map(String).join('.')}` : ''
  const reason = issueReason(issue)
  throw new ToolError(`Entrada inválida${at}${reason ? `: ${reason}` : ''}. Revisa el formato y repite.`)
}

function writeDisabledReason(): string | null {
  try {
    odooWriteEnv()
    return null
  } catch (error) {
    return error instanceof Error ? error.message : 'La escritura en Odoo está deshabilitada en este servidor.'
  }
}

const errorName = (error: unknown) => (error instanceof Error ? error.name : 'unknown')

function partnerView(partner: WritePartner): PreviewClient {
  return { id: partner.id, nombre: partner.name, rfc: partner.vat, es_la_empresa: partner.isCompany }
}

const companyWarning = (name: string) =>
  `El cliente es el contacto de la propia empresa (${name}): revisa que de verdad sea para ella.`

function requirePartner(sale: SaleRecord): number {
  if (sale.partnerId === null) throw new OdooError(`No pude leer el cliente de la ${sale.name}.`)
  return sale.partnerId
}

function saleView(sale: SaleRecord): SaleView {
  const amount = (value: unknown) => (typeof value === 'number' ? value : null)
  return {
    folio: sale.name,
    id: sale.id,
    estado: SALE_STATE_LABEL[sale.state] ?? sale.state,
    subtotal: amount(sale.raw.amount_untaxed),
    iva: amount(sale.raw.amount_tax),
    total: amount(sale.raw.amount_total),
    moneda: many2oneName(sale.raw.currency_id),
    cliente: sale.partnerName,
  }
}

function quoteView(sale: SaleRecord): PreviewQuote {
  return {
    id: sale.id,
    folio: sale.name,
    estado: SALE_STATE_LABEL[sale.state] ?? sale.state,
    subtotal: numberOr(sale.raw.amount_untaxed, 0),
    total: numberOr(sale.raw.amount_total, 0),
    moneda: many2oneName(sale.raw.currency_id),
    vigencia: sale.validityDate,
  }
}

/** Editing and confirming are for quotations: a sale, a cancelled or a locked order is done in Odoo. */
function assertOpenQuotation(sale: SaleRecord): void {
  if (sale.state === 'sale') {
    throw new ToolError(
      `La ${sale.name} ya es venta confirmada: no se edita desde el asistente (para facturar, odoo_create_draft_invoice).`,
    )
  }
  if (sale.state === 'cancel') throw new ToolError(`La ${sale.name} está cancelada: no se edita ni se confirma desde el asistente.`)
  if (sale.state !== 'draft' && sale.state !== 'sent') {
    throw new ToolError(`La ${sale.name} está en estado ${sale.state}: solo se trabajan cotizaciones en borrador o enviadas.`)
  }
  if (sale.locked) throw new ToolError(`La ${sale.name} está bloqueada en Odoo: desbloquéala ahí si hay que cambiarla.`)
}

const productsOfLines = (current: readonly CurrentLine[]) =>
  new Map(current.map((line) => [line.id, line.kind === 'producto' ? line.productId : null]))

const productLinesOf = (plan: LinePlan) => plan.desired.filter((line) => line.kind === 'producto')

const RESULT_FIELDS = ['name', 'state', 'amount_untaxed', 'amount_tax', 'amount_total', 'currency_id', 'partner_id', 'date_order']
const PREVIEW_SALE_FIELDS = [...RESULT_FIELDS, 'locked', 'write_date', 'validity_date']
// The save appends its trail to the owner's note: it must be read, never assumed empty.
const SAVE_SALE_FIELDS = [...PREVIEW_SALE_FIELDS, 'internal_note']

const TWIN_WINDOW_MS = 6 * 3_600_000

/** Odoo datetimes are UTC "YYYY-MM-DD HH:MM:SS". */
const odooDateTime = (epochMs: number) => new Date(epochMs).toISOString().slice(0, 19).replace('T', ' ')

/** A preview identical to one created in the last 6 h warns before a second click duplicates it. */
async function recentTwin(reader: OdooCaller, partnerId: number, h10: string): Promise<string | null> {
  const rows = rowsOf(
    await reader('sale.order', 'search_read', {
      domain: [
        ['partner_id', '=', partnerId],
        ['origin', '=ilike', `${escapeLike(ORIGIN_PREFIX)}%`],
        ['create_date', '>=', odooDateTime(Date.now() - TWIN_WINDOW_MS)],
        ['state', '!=', 'cancel'],
      ],
      fields: ['name', 'internal_note', 'create_date'],
      limit: 5,
      order: 'create_date desc',
    }),
  )
  const twin = rows.find((row) => typeof row.internal_note === 'string' && row.internal_note.includes(`contenido ${h10}`))
  if (!twin) return null
  const created = typeof twin.create_date === 'string' ? Date.parse(`${twin.create_date.replace(' ', 'T')}Z`) : NaN
  const minutes = Number.isFinite(created) ? Math.max(0, Math.round((Date.now() - created) / 60_000)) : null
  const when = minutes === null ? 'hace poco' : `hace ${minutes} min`
  return `Ya creaste una igual ${when}: ${String(twin.name)}. Si no quieres otra, no la guardes.`
}

interface PreviewParts {
  readonly kind: QuotationKeyKind
  readonly modo: QuotationPreview['modo']
  readonly input: PreviewQuotationInput
  readonly cliente: PreviewClient
  readonly cotizacion: PreviewQuote | null
  readonly lineas: readonly PreviewLine[]
  readonly lineasComoEntrada?: readonly LineRequest[]
  readonly nuevos: readonly NewProductView[]
  readonly paraAlta: readonly ProductForCreation[]
  readonly subtotal: number
  readonly moneda: string
  readonly bloqueos: readonly string[]
  readonly avisos: readonly string[]
  readonly alConfirmar: string
  readonly partnerId: number
  readonly saleId: number | null
  readonly writeDate: string | null
}

function previewNextStep(modo: QuotationPreview['modo'], canSave: boolean, hasNew: boolean): string {
  if (!canSave) return `${NOTHING_SAVED} Corrige lo que dicen los bloqueos y vuelve a pedir la vista previa.`
  if (modo === 'revisar') {
    return `${NOTHING_SAVED} Para confirmarla como venta: muestra al_confirmar, espera el sí y llama odoo_save_quotation con el folio, confirmar: true y la clave. Para editarla: pide la vista previa con el folio y lineas (parte de lineas_como_entrada).`
  }
  if (hasNew) {
    return `${NOTHING_SAVED} Los productos nuevos solo se dan de alta con el botón de la vista (Claude web, escritorio o móvil). Sin vista, dalos de alta en Odoo o quita esas líneas y vuelve a pedir la vista previa.`
  }
  return `${NOTHING_SAVED} Muestra el resumen, espera el sí y llama odoo_save_quotation con los mismos datos y la clave.`
}

/** Blocked → no key; otherwise the key, and the products authorization only in _meta (ADR-040). */
function finishPreview(proof: AdminProof, parts: PreviewParts): QuotationPreview | ResultWithMeta<QuotationPreview> {
  const disabled = writeDisabledReason()
  const bloqueos = [...parts.bloqueos, ...(disabled ? [disabled] : [])]
  const canSave = bloqueos.length === 0
  const key = canSave
    ? issueQuotationKey(proof, {
        kind: parts.kind,
        input: parts.input,
        partnerId: parts.partnerId,
        saleId: parts.saleId,
        writeDate: parts.writeDate,
      })
    : null
  const data: QuotationPreview = {
    modo: parts.modo,
    cliente: parts.cliente,
    cotizacion: parts.cotizacion,
    lineas: parts.lineas,
    ...(parts.lineasComoEntrada ? { lineas_como_entrada: parts.lineasComoEntrada } : {}),
    productos_nuevos: parts.nuevos,
    productos_para_alta: parts.paraAlta,
    subtotal: parts.subtotal,
    moneda: parts.moneda,
    impuestos: TAX_NOTE,
    bloqueos,
    avisos: parts.avisos,
    al_confirmar: parts.alConfirmar,
    puede_guardar: canSave,
    clave: key?.clave ?? null,
    vence: key?.vence ?? null,
    siguiente_paso: previewNextStep(parts.modo, canSave, parts.paraAlta.length > 0),
  }
  if (!key || parts.paraAlta.length === 0) return data
  const { autorizacion } = issueProductsAuthorization(proof, parts.paraAlta)
  return withResultMeta(data, { [PRODUCTS_AUTHORIZATION_META]: autorizacion })
}

async function previewCreate(
  reader: OdooCaller,
  proof: AdminProof,
  input: PreviewQuotationInput,
  lines: readonly LineRequest[],
): Promise<QuotationPreview | ResultWithMeta<QuotationPreview>> {
  const partner = await resolvePartnerForWrite(reader, input.cliente ?? '')
  const { matches, products } = await resolveProductsForWrite(reader, lines)
  const plan = planQuotationLines({ mode: 'crear', lines, matches })
  const twin = await recentTwin(reader, partner.id, quotationContentHash(input).slice(0, 10))
  return finishPreview(proof, {
    kind: 'crear',
    modo: 'crear',
    input,
    cliente: partnerView(partner),
    cotizacion: null,
    lineas: plan.lineas,
    nuevos: plan.nuevos,
    paraAlta: plan.paraAlta,
    subtotal: plan.subtotal,
    // Every partner uses the "Default (MXN)" pricelist (verified 2026-10-16).
    moneda: 'MXN',
    bloqueos: plan.bloqueos,
    avisos: [...(twin ? [twin] : []), ...(partner.isCompany ? [companyWarning(partner.name)] : []), ...plan.avisos],
    alConfirmar: confirmEffects(productLinesOf(plan), products).texto,
    partnerId: partner.id,
    saleId: null,
    writeDate: null,
  })
}

async function previewExisting(
  reader: OdooCaller,
  proof: AdminProof,
  input: PreviewQuotationInput,
  lines: readonly LineRequest[],
  modo: 'editar' | 'revisar',
): Promise<QuotationPreview | ResultWithMeta<QuotationPreview>> {
  const sale = await requireExactSale(reader, input.folio ?? '', PREVIEW_SALE_FIELDS)
  assertOpenQuotation(sale)
  if (!sale.writeDate) throw new OdooError(`No pude leer la última modificación de la ${sale.name}: no seguí.`)
  const partnerId = requirePartner(sale)
  const current = await readSaleLines(reader, sale)
  const { matches, products } = await resolveProductsForWrite(reader, lines, { lineProducts: productsOfLines(current) })
  const cliente: PreviewClient = {
    id: partnerId,
    nombre: sale.partnerName ?? '',
    rfc: null,
    es_la_empresa: partnerId === COMPANY_PARTNER_ID,
  }
  const common = {
    input,
    cliente,
    cotizacion: quoteView(sale),
    moneda: many2oneName(sale.raw.currency_id) ?? 'MXN',
    partnerId,
    saleId: sale.id,
    writeDate: sale.writeDate,
  }
  const avisos = cliente.es_la_empresa ? [companyWarning(cliente.nombre)] : []

  if (modo === 'revisar') {
    const productLines = current.filter((line) => line.kind === 'producto')
    return finishPreview(proof, {
      ...common,
      kind: 'confirmar',
      modo,
      lineas: currentPreviewLines(current, products),
      lineasComoEntrada: linesAsInput(current),
      nuevos: [],
      paraAlta: [],
      subtotal: numberOr(sale.raw.amount_untaxed, 0),
      bloqueos: productLines.length === 0 ? [`La ${sale.name} no tiene productos: no se puede confirmar.`] : [],
      avisos: [...avisos, ...unechoableWarnings(current)],
      alConfirmar: confirmEffects(
        productLines.map((line) => (line.productId !== null ? { productId: line.productId } : {})),
        products,
      ).texto,
    })
  }

  const plan = planQuotationLines({ mode: 'editar', lines, matches, current })
  const validityChanges = input.vigencia !== undefined && input.vigencia !== sale.validityDate
  const unchanged = plan.diff !== null && isEmptyDiff(plan.diff) && !validityChanges
  return finishPreview(proof, {
    ...common,
    kind: 'editar',
    modo,
    lineas: plan.lineas,
    nuevos: plan.nuevos,
    paraAlta: plan.paraAlta,
    subtotal: plan.subtotal,
    bloqueos: [...plan.bloqueos, ...(unchanged ? [`No hay cambios: la ${sale.name} ya está así.`] : [])],
    avisos: [
      ...avisos,
      ...(sale.state === 'sent' ? [sentWarning(sale.name)] : []),
      ...plan.avisos,
    ],
    alConfirmar: confirmEffects(productLinesOf(plan), products).texto,
  })
}

const sentWarning = (name: string) => `La ${name} ya se la enviaste al cliente: Odoo no se la reenvía al guardar los cambios.`

const missingConfirmTrail = (name: string) =>
  `La ${name} está confirmada, pero su nota interna no dice que la confirmó el asistente con esta clave: si fue esta llamada (quedó incierta), anota en Odoo quién la pidió.`

/**
 * Reads only: resolves the customer or the sale and every product in one search, and signs a key
 * for exactly this content. New products ride with an authorization in _meta, for the view's button.
 */
export async function odooPreviewQuotation(
  deps: OdooQuotationDeps,
  ctx: ToolContext,
  raw: PreviewQuotationInput,
): Promise<QuotationPreview | ResultWithMeta<QuotationPreview>> {
  // It signs keys: a member or a demoted admin never reaches Odoo.
  const proof = await requireLiveAdmin(ctx)
  const input = parseInput(previewSchema, raw)
  const mode = quotationMode(input)
  const lines = input.lineas ?? []
  assertQuotationLines(lines, mode)
  if (input.vigencia !== undefined && input.vigencia < todayInMexico()) {
    throw new ToolError(`La vigencia ${input.vigencia} ya pasó: usa hoy o una fecha posterior.`)
  }
  if (mode === 'crear') return previewCreate(deps.reader, proof, input, lines)
  if (mode === 'editar' || mode === 'revisar') return previewExisting(deps.reader, proof, input, lines, mode)
  throw new ToolError('La vista previa no confirma: pide la revisión con solo el folio.')
}

interface SaveRun {
  readonly reader: OdooCaller
  readonly writer: OdooWriter
  readonly proof: AdminProof
  readonly verified: VerifiedQuotationKey
  readonly input: SaveQuotationInput
  readonly lines: readonly LineRequest[]
  readonly dl: Deadline
}

/** A key from a clean preview can't land here with blocks, unless Odoo changed in between. */
function assertWritable(plan: LinePlan): void {
  if (plan.pendingNew.length > 0) {
    throw new ToolError(
      `${listOfLines(plan.pendingNew)}: el producto aún no existe en Odoo. Dalo de alta con el botón de la vista previa (o en Odoo) y repite la misma llamada. No escribí nada.`,
    )
  }
  if (plan.bloqueos.length > 0) throw new ToolError(`${PREVIEW_CHANGED_MESSAGE} ${plan.bloqueos[0]}`)
}

function assertSameAsPreview(sale: SaleRecord, verified: VerifiedQuotationKey): void {
  const { p, w } = verified.claims
  if (sale.partnerId !== p || sale.writeDate !== w) throw new ToolError(PREVIEW_CHANGED_MESSAGE)
}

function noteOf(sale: SaleRecord): OdooNote {
  const note = sale.raw.internal_note
  if (note === false || typeof note === 'string') return note
  throw new OdooError(`No pude leer la nota interna de la ${sale.name}: no escribí nada.`)
}

interface ExpectedPrice {
  readonly n: number
  readonly lineId: number | null
  readonly productId: number
  readonly price: number
}

/** Prices actually sent: every product line on create; on edit only the [1] and [0] ones. */
function expectedPrices(plan: LinePlan): ExpectedPrice[] {
  const actions = new Map((plan.diff?.actions ?? []).map((a) => [a.n, a]))
  return plan.desired.flatMap((line) => {
    if (line.kind !== 'producto' || line.productId === undefined || line.price === undefined) return []
    const action = actions.get(line.n)
    if (plan.diff && (!action || action.action === 'se_queda')) return []
    return [{ n: line.n, lineId: action?.lineId ?? null, productId: line.productId, price: line.price }]
  })
}

interface Reread {
  readonly cotizacion: SaleView
  readonly precios: PriceDifference[]
  readonly confirmacion?: { entregas: string[]; facturable_ya: number }
}

const REREAD_LINES_LIMIT = 200

/** After a write: what Odoo really saved. A failed read never turns a done write into an error. */
async function rereadAfterWrite(
  reader: OdooCaller,
  saleId: number,
  opts: { expected?: readonly ExpectedPrice[]; preexisting?: ReadonlySet<number>; deliveries?: boolean } = {},
): Promise<Reread | null> {
  try {
    const fields = opts.deliveries ? [...RESULT_FIELDS, 'picking_ids'] : RESULT_FIELDS
    const rows = rowsOf(await reader('sale.order', 'search_read', { domain: [['id', '=', saleId]], fields, limit: 1 }))
    if (rows.length !== 1) return null
    const sale = saleFromRow(rows[0])
    const lineRows = rowsOf(
      await reader('sale.order.line', 'search_read', {
        domain: [['order_id', '=', saleId], ['display_type', '=', false]],
        fields: ['product_id', 'price_unit', 'qty_to_invoice'],
        order: 'sequence asc, id asc',
        limit: REREAD_LINES_LIMIT,
      }),
    )
    const precios = priceDifferences(
      opts.expected ?? [],
      lineRows.map((row) => ({ id: numberOr(row.id, 0), productId: many2oneId(row.product_id), price: numberOr(row.price_unit, 0) })),
      opts.preexisting,
    )
    if (!opts.deliveries) return { cotizacion: saleView(sale), precios }
    const pickingIds = idsOf(sale.raw.picking_ids)
    const pickings = pickingIds.length
      ? rowsOf(
          await reader('stock.picking', 'search_read', {
            domain: [['id', 'in', pickingIds]],
            fields: ['name', 'state'],
            limit: 20,
            order: 'id asc',
          }),
        )
      : []
    return {
      cotizacion: saleView(sale),
      precios,
      confirmacion: {
        entregas: pickings.map((p) => p.name).filter((name): name is string => typeof name === 'string'),
        facturable_ya: lineRows.filter((row) => numberOr(row.qty_to_invoice, 0) > 0).length,
      },
    }
  } catch (error) {
    console.error('[odoo-write] reread after write failed', { saleId, error: errorName(error) })
    return null
  }
}

const rereadWarning = (saleId: number) =>
  `Se guardó en Odoo (id ${saleId}), pero no pude releerla para mostrarte sus montos: revísala ahí.`

function withReread(reread: Reread | null, fallback: SaleView): Pick<QuotationSaveResult, 'cotizacion' | 'precios_distintos' | 'aviso_relectura'> {
  if (!reread) return { cotizacion: fallback, aviso_relectura: rereadWarning(fallback.id) }
  return { cotizacion: reread.cotizacion, ...(reread.precios.length ? { precios_distintos: reread.precios } : {}) }
}

async function saveCreate(run: SaveRun): Promise<QuotationSaveResult> {
  // Before anything else: a retry of a create that did land finds it by the key's marker.
  const existing = rowsOf(
    await run.reader('sale.order', 'search_read', {
      domain: [['origin', '=', originMarker(run.verified.markers.k10)]],
      fields: RESULT_FIELDS,
      limit: 2,
      order: 'id asc',
    }),
  ).map(saleFromRow)
  if (existing.length > 0) {
    const sale = existing[0]
    if (sale.state === 'cancel') {
      throw new ToolError(`La ${sale.name} que creó esta vista previa está cancelada: pide una vista previa nueva para crear otra. No escribí nada.`)
    }
    return { cotizacion: saleView(sale), ya_existia: true, siguiente_paso: `Ya estaba creada con esta clave (${sale.name}): no escribí otra.` }
  }

  const grant = grantPreviewWrite(run.verified)
  const partner = await resolvePartnerForWrite(run.reader, run.input.cliente ?? '')
  if (partner.id !== run.verified.claims.p) throw new ToolError(PREVIEW_CHANGED_MESSAGE)
  const { matches } = await resolveProductsForWrite(run.reader, run.lines)
  const plan = planQuotationLines({ mode: 'crear', lines: run.lines, matches })
  assertWritable(plan)

  const saleId = await run.writer.createQuotation(
    run.proof,
    grant,
    {
      partner_id: partner.id,
      ...(run.input.vigencia !== undefined ? { validity_date: run.input.vigencia } : {}),
      lines: createLineVals(plan.desired),
    },
    run.dl,
  )
  const reread = await rereadAfterWrite(run.reader, saleId, { expected: expectedPrices(plan) })
  const saved = withReread(reread, {
    folio: null, id: saleId, estado: SALE_STATE_LABEL.draft, subtotal: null, iva: null, total: null, moneda: null, cliente: partner.name,
  })
  const folioText = saved.cotizacion.folio ?? `id ${saleId}`
  return {
    ...saved,
    siguiente_paso: `Quedó como cotización en BORRADOR (${folioText}); no se le envió al cliente. Para confirmarla como venta: odoo_preview_quotation con el folio (revisión), muestra al_confirmar y, tras el sí, odoo_save_quotation con el folio, confirmar: true y la clave.`,
  }
}

async function saveEdit(run: SaveRun): Promise<QuotationSaveResult> {
  const sale = await requireExactSale(run.reader, run.input.folio ?? '', SAVE_SALE_FIELDS)
  if (sale.id !== run.verified.claims.s) throw new ToolError(PREVIEW_CHANGED_MESSAGE)
  const current = await readSaleLines(run.reader, sale)
  const { matches } = await resolveProductsForWrite(run.reader, run.lines, { lineProducts: productsOfLines(current) })
  const plan = planQuotationLines({ mode: 'editar', lines: run.lines, matches, current })
  assertWritable(plan)
  const commands = plan.diff?.commands
  if (!plan.diff || !commands) throw new OdooError(`No pude calcular los cambios de la ${sale.name}: no escribí nada.`)

  const validity = run.input.vigencia !== undefined && run.input.vigencia !== sale.validityDate ? run.input.vigencia : undefined
  // Before the write_date lock: a retry after an edit that did land must say so, not "algo cambió".
  if (commands.length === 0 && validity === undefined) {
    return { cotizacion: saleView(sale), ya_existia: true, siguiente_paso: `La ${sale.name} ya estaba así: no escribí nada.` }
  }
  assertOpenQuotation(sale)
  assertSameAsPreview(sale, run.verified)
  const note = noteOf(sale)
  const grant = grantPreviewWrite(run.verified)

  await run.writer.updateQuotation(
    run.proof,
    grant,
    sale.id,
    { ...(commands.length > 0 ? { order_line: commands } : {}), ...(validity !== undefined ? { validity_date: validity } : {}) },
    ownedSaleLines(current.map((line) => ({ id: line.id, display_type: line.displayType }))),
    note,
    run.dl,
  )
  const reread = await rereadAfterWrite(run.reader, sale.id, {
    expected: expectedPrices(plan),
    preexisting: new Set(current.map((line) => line.id)),
  })
  const saved = withReread(reread, saleView(sale))
  return {
    ...saved,
    ...(plan.diff.removed.length > 0 ? { quitadas: plan.diff.removed.map((line) => line.name) } : {}),
    ...(sale.state === 'sent' ? { avisos: [sentWarning(sale.name)] } : {}),
    siguiente_paso: `Se guardaron los cambios en la ${sale.name}; sigue como ${saved.cotizacion.estado}.`,
  }
}

async function saveConfirm(run: SaveRun): Promise<QuotationSaveResult> {
  const sale = await requireExactSale(run.reader, run.input.folio ?? '', SAVE_SALE_FIELDS)
  if (sale.id !== run.verified.claims.s) throw new ToolError(PREVIEW_CHANGED_MESSAGE)
  const marker = { k10: run.verified.markers.k10 }
  // Before the write_date lock: a retry after a confirm that did land answers "ya estaba".
  if (sale.state === 'sale') {
    // An uncertain action_confirm never reached its trail: say so instead of a silent "ya estaba".
    const current = sale.raw.internal_note
    const trailed = noteHasKeyMarker(typeof current === 'string' ? current : false, marker.k10)
    if (!trailed) console.error('[odoo-write] confirmed sale without the trail of this key', { saleId: sale.id })
    const reread = await rereadAfterWrite(run.reader, sale.id, { deliveries: true })
    return {
      cotizacion: reread?.cotizacion ?? saleView(sale),
      ya_existia: true,
      ...(reread?.confirmacion ? { confirmacion: reread.confirmacion } : {}),
      ...(trailed ? {} : { aviso_rastro: missingConfirmTrail(sale.name) }),
      siguiente_paso: `La ${sale.name} ya estaba confirmada: no escribí nada.`,
    }
  }
  assertOpenQuotation(sale)
  const productLines = await run.reader('sale.order.line', 'search_count', {
    domain: [['order_id', '=', sale.id], ['display_type', '=', false]],
  })
  if (typeof productLines !== 'number' || productLines < 1) {
    throw new ToolError(`La ${sale.name} no tiene productos: no se puede confirmar.`)
  }
  assertSameAsPreview(sale, run.verified)
  const note = noteOf(sale)
  const grant = grantPreviewWrite(run.verified)

  await run.writer.confirmSale(run.proof, grant, sale.id, run.dl)
  let avisoRastro: string | undefined
  try {
    await run.writer.appendSaleTrail(run.proof, sale.id, note, 'Confirmada', run.dl, marker)
  } catch (error) {
    // The sale is confirmed either way: a missing trail line is reported, not undone.
    console.error('[odoo-write] trail failed after confirming', { saleId: sale.id, error: errorName(error) })
    avisoRastro = `La ${sale.name} quedó confirmada, pero no pude anotar en su nota interna quién la confirmó.`
  }
  const reread = await rereadAfterWrite(run.reader, sale.id, { deliveries: true })
  const saved = withReread(reread, { ...saleView(sale), estado: SALE_STATE_LABEL.sale })
  return {
    ...saved,
    ...(reread?.confirmacion ? { confirmacion: reread.confirmacion } : {}),
    ...(avisoRastro ? { aviso_rastro: avisoRastro } : {}),
    siguiente_paso: `La ${sale.name} quedó como VENTA confirmada. Para facturar: odoo_create_draft_invoice (la factura queda en borrador; se timbra en Odoo).`,
  }
}

/**
 * Writes what the preview showed, nothing else: the key binds admin, content, intent and the
 * sale's write_date. Retrying the same call never duplicates; drafts only, never posts nor stamps.
 */
export async function odooSaveQuotation(
  deps: OdooQuotationDeps,
  ctx: ToolContext,
  raw: SaveQuotationInput,
): Promise<QuotationSaveResult> {
  // First: the live-admin read counts against the request's budget (#144).
  const dl = startDeadline()
  const proof = await requireLiveAdmin(ctx)
  if (typeof raw?.clave !== 'string' || !raw.clave.trim()) throw new ToolError(PREVIEW_KEY_MISSING_MESSAGE)
  const input = parseInput(saveSchema, raw)
  // Throws the precise reason (no key, bad URL) before anything is read.
  odooWriteEnv()
  const mode = quotationMode(input)
  if (mode === 'revisar') {
    throw new ToolError('Con solo el folio no hay nada que guardar: manda las líneas para editar, o confirmar: true para confirmarla.')
  }
  const lines = input.lineas ?? []
  assertQuotationLines(lines, mode)
  const verified = verifyQuotationKey(proof, input.clave, { kind: mode, input })
  const run: SaveRun = { reader: deps.reader, writer: deps.writer, proof, verified, input, lines, dl }
  if (mode === 'crear') return saveCreate(run)
  if (mode === 'editar') return saveEdit(run)
  return saveConfirm(run)
}
