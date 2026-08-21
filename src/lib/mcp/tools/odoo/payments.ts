/**
 * Odoo F6 — complementos de pago REP (#70, ADR-025). La verdad del timbrado es
 * l10n_mx_edi.document (los l10n_mx_edi_* del pago computan false); el puente
 * pago↔REP es por facturas conciliadas — no hay FK directa.
 */

import type { OdooCaller } from '@/lib/odoo/client'
import { normalizeRecords, todayIso } from '@/lib/odoo/normalize'
import { ToolError } from '../../shared'
import { findByFolio, SAT_STATE, timbrado } from './documents'

const REP_STATE: Record<string, string> = {
  payment_sent: 'timbrado',
  payment_sent_pue: 'PUE — no requiere REP',
  payment_sent_failed: 'falló el timbrado',
  payment_cancel: 'cancelado',
  payment_cancel_failed: 'falló la cancelación',
}

/** Estados de REP que dejan al pago en regla ante el SAT. */
const REP_OK_STATES = new Set(['payment_sent', 'payment_sent_pue'])

const PAYMENT_STATE: Record<string, string> = {
  draft: 'borrador',
  in_process: 'en proceso',
  paid: 'pagado',
  canceled: 'cancelado',
  rejected: 'rechazado',
}

const satLabel = (sat: unknown) =>
  (typeof sat === 'string' && SAT_STATE[sat]) || sat || null

const repLabel = (state: unknown) =>
  (typeof state === 'string' && REP_STATE[state]) || state || null

/** Ids de las facturas conciliadas del pago (many2many crudo → number[]). */
function invoiceIdsOf(payment: Record<string, unknown>): number[] {
  const raw = payment.reconciled_invoice_ids
  return Array.isArray(raw) ? raw.filter((v): v is number => typeof v === 'number') : []
}

/** Un doc REP cubre al pago si abarca TODAS sus facturas conciliadas. */
function covers(docInvoiceIds: unknown, paymentInvoiceIds: number[]): boolean {
  if (!Array.isArray(docInvoiceIds)) return false
  const set = new Set(docInvoiceIds)
  return paymentInvoiceIds.every((id) => set.has(id))
}

// ── odoo_payment_detail ────────────────────────────────────────────────

const PAYMENT_FIELDS = [
  'name', 'partner_id', 'date', 'amount', 'payment_type', 'state', 'memo',
  'reconciled_invoice_ids',
]

const REP_DOC_FIELDS = ['move_id', 'invoice_ids', 'state', 'sat_state', 'attachment_uuid', 'datetime', 'message']

export async function odooPaymentDetail(odoo: OdooCaller, input: { folio: string }) {
  const result = await findByFolio(odoo, 'account.payment', input.folio, PAYMENT_FIELDS)
  if (!result.found) {
    return { encontrado: false as const, mensaje: result.mensaje, coincidencias: result.coincidencias }
  }
  const payment = result.found
  const invoiceIds = invoiceIdsOf(payment)

  // 2 llamadas más, serializadas: los REP que tocan sus facturas + las facturas.
  const reps = invoiceIds.length
    ? normalizeRecords(
        await odoo('l10n_mx_edi.document', 'search_read', {
          domain: [['invoice_ids', 'in', invoiceIds], ['state', 'like', 'payment%']],
          fields: REP_DOC_FIELDS,
          limit: 10,
          order: 'datetime desc',
        }),
      )
    : []
  const invoices = invoiceIds.length
    ? normalizeRecords(
        await odoo('account.move', 'search_read', {
          domain: [['id', 'in', invoiceIds]],
          fields: [
            'name', 'invoice_date', 'amount_total', 'amount_residual', 'payment_state',
            'l10n_mx_edi_cfdi_uuid', 'l10n_mx_edi_cfdi_state', 'l10n_mx_edi_cfdi_sat_state',
          ],
          limit: invoiceIds.length,
        }),
      )
    : []

  const invoiceName = new Map(invoices.map((inv) => [inv.id as number, inv.name]))

  return {
    encontrado: true as const,
    pago: {
      folio: payment.name,
      cliente: payment.partner_id,
      fecha: payment.date,
      monto: payment.amount,
      tipo: payment.payment_type === 'inbound' ? 'cobro' : 'pago a proveedor',
      estado: (typeof payment.state === 'string' && PAYMENT_STATE[payment.state]) || payment.state,
      referencia: payment.memo,
    },
    complemento_pago: reps.length
      ? reps.map((doc) => ({
          estado: repLabel(doc.state),
          estado_sat: satLabel(doc.sat_state),
          folio_fiscal: doc.attachment_uuid,
          fecha: doc.datetime,
          asiento: doc.move_id,
          facturas_que_cubre: Array.isArray(doc.invoice_ids)
            ? doc.invoice_ids.map((id) => invoiceName.get(id as number) ?? `id ${id}`)
            : [],
          detalle: doc.message ?? undefined,
        }))
      : {
          timbrado: false as const,
          detalle: invoiceIds.length
            ? 'Sin REP: ningún complemento de pago cubre las facturas de este pago.'
            : 'El pago no tiene facturas conciliadas — no hay REP que buscar.',
        },
    facturas_que_paga: invoices.map((inv) => ({
      folio: inv.name,
      emitida: inv.invoice_date,
      total: inv.amount_total,
      saldo_pendiente: inv.amount_residual,
      estado_pago: inv.payment_state,
      timbrado: timbrado(inv),
    })),
  }
}

// ── odoo_rep_audit ─────────────────────────────────────────────────────

export interface RepAuditInput {
  date_from?: string
  date_to?: string
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const AUDIT_LIMIT = 50

/**
 * Barrido: pagos del rango + sus docs REP (sin filtro de fecha: el REP llega
 * después) + 3ª llamada lazy con la política PUE/PPD — 100% PUE no requiere REP.
 */
export async function odooRepAudit(odoo: OdooCaller, input: RepAuditInput = {}) {
  for (const date of [input.date_from, input.date_to]) {
    if (date && !DATE_RE.test(date)) throw new ToolError(`Fecha inválida "${date}" — usa YYYY-MM-DD`)
  }
  const today = todayIso()
  // Default: el barrido del último mes (~30 días).
  const from = input.date_from ?? new Date(Date.parse(`${today}T00:00:00Z`) - 30 * 86_400_000).toISOString().slice(0, 10)
  const to = input.date_to ?? today

  const payments = normalizeRecords(
    await odoo('account.payment', 'search_read', {
      domain: [
        ['payment_type', '=', 'inbound'],
        ['state', 'in', ['in_process', 'paid']],
        ['date', '>=', from],
        ['date', '<=', to],
      ],
      fields: PAYMENT_FIELDS,
      limit: AUDIT_LIMIT,
      order: 'date asc',
    }),
  )

  const allInvoiceIds = [...new Set(payments.flatMap(invoiceIdsOf))]
  const REP_DOCS_LIMIT = 200
  const reps = allInvoiceIds.length
    ? normalizeRecords(
        await odoo('l10n_mx_edi.document', 'search_read', {
          domain: [['invoice_ids', 'in', allInvoiceIds], ['state', 'like', 'payment%']],
          fields: ['invoice_ids', 'state', 'sat_state', 'attachment_uuid', 'datetime'],
          limit: REP_DOCS_LIMIT,
        }),
      )
    : []

  const sinFacturas: unknown[] = []
  const sinRep: unknown[] = []
  const sinRepIds: number[][] = []
  const repConProblema: unknown[] = []
  let enRegla = 0

  for (const payment of payments) {
    const ids = invoiceIdsOf(payment)
    const resumen = {
      folio: payment.name,
      cliente: payment.partner_id,
      fecha: payment.date,
      monto: payment.amount,
    }
    if (!ids.length) {
      sinFacturas.push(resumen)
      continue
    }
    const docs = reps.filter((doc) => covers(doc.invoice_ids, ids))
    if (!docs.length) {
      sinRep.push(resumen)
      sinRepIds.push(ids)
      continue
    }
    // El más reciente manda: un REP re-timbrado sustituye al fallido.
    const latest = docs.reduce((a, b) => (String(a.datetime) >= String(b.datetime) ? a : b))
    const ok = REP_OK_STATES.has(String(latest.state)) && ['valid', 'skip'].includes(String(latest.sat_state))
    if (ok) {
      enRegla += 1
    } else {
      repConProblema.push({
        ...resumen,
        estado_rep: repLabel(latest.state),
        estado_sat: satLabel(latest.sat_state),
        fecha_rep: latest.datetime,
      })
    }
  }

  // Reclasificación PUE: un pago cuyas facturas son TODAS PUE no requiere
  // REP — sin esto se reportaría como pendiente (falso positivo).
  let noRequiere = 0
  let sinRepFinal = sinRep
  if (sinRep.length) {
    const candidateIds = [...new Set(sinRepIds.flat())]
    const policies = normalizeRecords(
      await odoo('account.move', 'search_read', {
        domain: [['id', 'in', candidateIds]],
        fields: ['l10n_mx_edi_payment_policy'],
        limit: candidateIds.length,
      }),
    )
    const policy = new Map(policies.map((inv) => [inv.id as number, inv.l10n_mx_edi_payment_policy]))
    sinRepFinal = sinRep.filter((resumen, i) => {
      const allPue = sinRepIds[i].every((id) => policy.get(id) === 'PUE')
      if (allPue) noRequiere += 1
      return !allPue
    })
  }

  return {
    periodo: { desde: from, hasta: to },
    pagos_revisados: payments.length,
    en_regla: enRegla,
    no_requiere_rep: noRequiere || undefined,
    sin_rep: sinRepFinal,
    rep_con_problema: repConProblema,
    sin_facturas_conciliadas: sinFacturas.length ? sinFacturas : undefined,
    nota: [
      payments.length === AUDIT_LIMIT
        ? `Se revisó el máximo (${AUDIT_LIMIT} pagos); acota el rango de fechas para cubrir el resto.`
        : null,
      // Sin esto un "sin REP" podría ser truncamiento silencioso (review PR #75).
      reps.length === REP_DOCS_LIMIT
        ? `Se alcanzó el máximo de documentos REP (${REP_DOCS_LIMIT}); algún "sin REP" podría deberse al corte — acota el rango de fechas.`
        : null,
    ].filter(Boolean).join(' ') || undefined,
  }
}
