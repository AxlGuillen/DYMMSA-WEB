/**
 * The closed facade over the Odoo write transport (#144, ADR-040): six operations whose ids,
 * context and trail are built HERE, so a tool can't pass context, wizard ids nor internal_note.
 */

import {
  createOdooRawWriter,
  OdooError,
  OdooUncertainWriteError,
  type OdooRawWriter,
  type UncertainRetry,
} from './client'
import type { Deadline } from './deadline'
import {
  assertLineUpdateFits,
  ODOO_WRITE_OPERATIONS,
  originMarker,
  type ProductCreateVals,
  type SaleLineCommand,
  type SaleLineKind,
  type SaleLineVals,
  type WriteOperationName,
} from './write-catalog'
import { assertPreviewGrant, type PreviewGrant } from './preview-token'
import { assertAdminProof, type AdminProof } from './write-guard'

export type TrailAction = 'Creada' | 'Editada' | 'Confirmada' | 'Factura en borrador creada'

/** Trails that ride on their own write; 'Creada' and 'Editada' travel inside create/update. */
export type FollowUpTrailAction = Extract<TrailAction, 'Confirmada' | 'Factura en borrador creada'>

// After create_invoices there is no preview key: an uncertain trail gets the invoice's advice.
const TRAIL_RETRY: Readonly<Record<FollowUpTrailAction, UncertainRetry>> = Object.freeze({
  Confirmada: 'quotation',
  'Factura en borrador creada': 'invoice',
})

declare const ownedLinesBrand: unique symbol

/** THIS sale's lines as Odoo reread them (id → kind); only ownedSaleLines() builds it. */
export type OwnedSaleLines = ReadonlyMap<number, SaleLineKind> & { readonly [ownedLinesBrand]: true }

/** A sale.order.line row from search_read: display_type false = product line. */
export interface SaleLineRow {
  readonly id: unknown
  readonly display_type: unknown
}

const LINES_UNREADABLE = 'No pude leer las líneas de la cotización: no escribí nada.'

// Odoo's [1]/[2] commands write or unlink by id without checking the order: ownership is checked here.
export function ownedSaleLines(rows: readonly SaleLineRow[]): OwnedSaleLines {
  const lines = new Map<number, SaleLineKind>()
  for (const { id, display_type: type } of rows) {
    const kind: SaleLineKind | null = type === false ? 'product' : typeof type === 'string' && type ? 'display' : null
    if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0 || kind === null) {
      throw new OdooError(LINES_UNREADABLE)
    }
    lines.set(id, kind)
  }
  const readonlyLines: ReadonlyMap<number, SaleLineKind> = lines
  return readonlyLines as OwnedSaleLines
}

export interface SaleOrderCreateVals {
  partner_id: number
  validity_date?: string
  /** Plain line values: the writer wraps each one as [0, 0, line]. */
  lines: readonly SaleLineVals[]
}

export interface SaleOrderWriteVals {
  order_line?: readonly SaleLineCommand[]
  validity_date?: string
}

/** Signed preview key → idempotency marker (k10) and content hash (h10), ADR-040. */
export interface MarkerKeys {
  k10: string
  h10: string
}

/** sale.order.internal_note as read: Odoo returns an empty html field as false. */
export type OdooNote = string | false

/** create/update/confirm demand a PreviewGrant: an expired or skipped preview can't reach them (ADR-040). */
export interface OdooWriter {
  createQuotation(proof: AdminProof, grant: PreviewGrant, vals: SaleOrderCreateVals, dl: Deadline): Promise<number>
  updateQuotation(
    proof: AdminProof,
    grant: PreviewGrant,
    saleId: number,
    vals: SaleOrderWriteVals,
    ownedLines: OwnedSaleLines,
    currentNote: OdooNote,
    dl: Deadline,
  ): Promise<void>
  confirmSale(proof: AdminProof, grant: PreviewGrant, saleId: number, dl: Deadline): Promise<void>
  /** `keys`: the confirming key's marker, so a retry after an uncertain confirm can look for its trail. */
  appendSaleTrail(
    proof: AdminProof,
    saleId: number,
    currentNote: OdooNote,
    action: FollowUpTrailAction,
    dl: Deadline,
    keys?: Pick<MarkerKeys, 'k10'>,
  ): Promise<void>
  createProducts(proof: AdminProof, vals: readonly ProductCreateVals[], dl: Deadline): Promise<number[]>
  /** Wizard create + create_invoices with the same key: rule 161 lets only its creator use it. */
  createDraftInvoice(proof: AdminProof, saleId: number, dl: Deadline): Promise<void>
}

export interface WriteLogEntry {
  op: WriteOperationName
  ids: number[]
  actor: string
}

interface WriterDeps {
  now?: () => number
  /** Ids and the actor only: never amounts nor customer names. */
  log?: (entry: WriteLogEntry) => void
}

const HTML_ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char])

function mexicoDateTime(at: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Mexico_City',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at)
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')} ${part('hour')}:${part('minute')}`
}

/** Odoo records every write as the key's owner: this line says which admin asked for it (ADR-040). */
export function trailNote(
  action: TrailAction,
  displayName: string,
  at: Date,
  keys?: Pick<MarkerKeys, 'k10'> & Partial<Pick<MarkerKeys, 'h10'>>,
): string {
  const who = action === 'Creada' ? 'el asistente (MCP)' : 'el asistente'
  const marker = keys ? ` · clave ${keys.k10}${keys.h10 ? ` · contenido ${keys.h10}` : ''}` : ''
  return `<p>${action} por ${who} a petición de ${escapeHtml(displayName)} · ${mexicoDateTime(at)}${marker}</p>`
}

/** k10 is unique per preview key: only the trail written with that key carries it. */
export function noteHasKeyMarker(note: OdooNote, k10: string): boolean {
  return typeof note === 'string' && /^[0-9a-f]{10}$/.test(k10) && note.includes(`clave ${k10}`)
}

const NOTE_UNREADABLE = 'No pude leer la nota interna de la venta: no escribí nada.'

/** Appended, never replacing what the owner wrote: a note left out of the read must not erase it. */
function withTrail(currentNote: OdooNote, trail: string): string {
  if (currentNote === false) return trail
  if (typeof currentNote !== 'string') throw new OdooError(NOTE_UNREADABLE)
  return `${currentNote}${trail}`
}

function returnedIds(result: unknown, expected: number): number[] | null {
  if (!Array.isArray(result) || result.length !== expected) return null
  return result.every((id) => Number.isInteger(id) && id > 0) ? (result as number[]) : null
}

const uncertain = (name: WriteOperationName) =>
  new OdooUncertainWriteError(name, ODOO_WRITE_OPERATIONS[name].retry)

export function createOdooWriter(raw: OdooRawWriter, deps: WriterDeps = {}): OdooWriter {
  // Looked up per call so a faked clock (tests) is the one used.
  const now = deps.now ?? (() => Date.now())
  const log = deps.log ?? ((entry: WriteLogEntry) => console.info('[odoo-write]', entry))

  return Object.freeze({
    async createQuotation(proof, grant, vals, dl) {
      assertAdminProof(proof, now())
      assertPreviewGrant(grant, { kind: 'crear', userId: proof.userId, saleId: null, partnerId: vals.partner_id }, now())
      const keys = grant.markers
      const result = await raw(
        'sale.order',
        'create',
        {
          vals_list: [
            {
              partner_id: vals.partner_id,
              origin: originMarker(keys.k10),
              internal_note: trailNote('Creada', proof.displayName, new Date(now()), keys),
              ...(vals.validity_date !== undefined ? { validity_date: vals.validity_date } : {}),
              order_line: vals.lines.map((line) => [0, 0, { ...line }]),
            },
          ],
        },
        dl,
      )
      // The order may exist already: only the same preview key finds it again.
      const ids = returnedIds(result, 1)
      if (!ids) throw uncertain('sale.order.create')
      log({ op: 'sale.order.create', ids, actor: proof.userId })
      return ids[0]
    },

    async updateQuotation(proof, grant, saleId, vals, ownedLines, currentNote, dl) {
      assertAdminProof(proof, now())
      assertPreviewGrant(grant, { kind: 'editar', userId: proof.userId, saleId }, now())
      if (vals.order_line === undefined && vals.validity_date === undefined) {
        throw new OdooError('No hay cambios que guardar en la cotización: no escribí nada.')
      }
      for (const command of vals.order_line ?? []) {
        if (command[0] === 0) continue
        const kind = ownedLines.get(command[1])
        if (kind === undefined) throw new OdooError(`La línea ${command[1]} no es de esta cotización: no escribí nada.`)
        if (command[0] === 1) assertLineUpdateFits(kind, command[1], command[2])
      }
      const trail = trailNote('Editada', proof.displayName, new Date(now()))
      await raw(
        'sale.order',
        'write',
        {
          ids: [saleId],
          vals: {
            ...(vals.order_line !== undefined
              ? { order_line: vals.order_line.map((command) => [command[0], command[1], cloneCommandValue(command[2])]) }
              : {}),
            ...(vals.validity_date !== undefined ? { validity_date: vals.validity_date } : {}),
            internal_note: withTrail(currentNote, trail),
          },
        },
        dl,
      )
      log({ op: 'sale.order.write', ids: [saleId], actor: proof.userId })
    },

    async confirmSale(proof, grant, saleId, dl) {
      assertAdminProof(proof, now())
      assertPreviewGrant(grant, { kind: 'confirmar', userId: proof.userId, saleId }, now())
      // No context ever: send_email would mail the customer the confirmation (ADR-040).
      await raw('sale.order', 'action_confirm', { ids: [saleId] }, dl)
      log({ op: 'sale.order.action_confirm', ids: [saleId], actor: proof.userId })
    },

    async appendSaleTrail(proof, saleId, currentNote, action, dl, keys) {
      assertAdminProof(proof, now())
      const internalNote = withTrail(currentNote, trailNote(action, proof.displayName, new Date(now()), keys))
      const retry = TRAIL_RETRY[action]
      try {
        await raw('sale.order', 'write', { ids: [saleId], vals: { internal_note: internalNote } }, dl)
      } catch (error) {
        if (error instanceof OdooUncertainWriteError && error.retry !== retry) {
          throw new OdooUncertainWriteError(error.operation, retry, error.status)
        }
        throw error
      }
      log({ op: 'sale.order.write', ids: [saleId], actor: proof.userId })
    },

    async createProducts(proof, vals, dl) {
      assertAdminProof(proof, now())
      const result = await raw('product.product', 'create', { vals_list: vals.map((v) => ({ ...v })) }, dl)
      const ids = returnedIds(result, vals.length)
      if (!ids) throw uncertain('product.product.create')
      log({ op: 'product.product.create', ids, actor: proof.userId })
      return ids
    },

    async createDraftInvoice(proof, saleId, dl) {
      assertAdminProof(proof, now())
      const context = () => ({ active_model: 'sale.order', active_ids: [saleId], active_id: saleId })
      const wizard = await raw(
        'sale.advance.payment.inv',
        'create',
        {
          vals_list: [{ advance_payment_method: 'delivered', sale_order_ids: [[6, 0, [saleId]]] }],
          context: context(),
        },
        dl,
      )
      // A wizard without an invoice is a harmless transient record: retrying is safe.
      const wizardIds = returnedIds(wizard, 1)
      if (!wizardIds) {
        throw new OdooError('Odoo no devolvió el asistente de factura: no se creó ninguna factura. Vuelve a intentarlo.')
      }
      log({ op: 'sale.advance.payment.inv.create', ids: wizardIds, actor: proof.userId })
      // Without open_invoices: the result is not needed, the tool rereads invoice_ids.
      await raw('sale.advance.payment.inv', 'create_invoices', { ids: wizardIds, context: context() }, dl)
      log({ op: 'sale.advance.payment.inv.create_invoices', ids: [saleId], actor: proof.userId })
    },
  } satisfies OdooWriter)
}

function cloneCommandValue(value: SaleLineCommand[2]): SaleLineCommand[2] {
  return typeof value === 'object' ? { ...value } : value
}

/** Production writer: ODOO_WRITE_API_KEY is read per call, never at import (#144). */
export const odooWriter: OdooWriter = createOdooWriter(createOdooRawWriter())
