/**
 * Odoo phase 8 (#113): the customer's receivable figures as Odoo computes them — total_due,
 * total_overdue and DSO (average days to pay). Computed and not stored, so the ranking reads
 * every customer and orders in memory; no domain or order on these fields ever reaches Odoo.
 */

import type { OdooCaller } from '@/lib/odoo/client'
import { normalizeRecords } from '@/lib/odoo/normalize'

// 100 per page: every row computes three receivable fields against the partner's ledger, and the
// client aborts a call at 25 s (review PR #117) — one more page beats one lost call.
const PAGE = 100
const MAX_PAGES = 10
const DEFAULT_LIMIT = 10
const MAX_LIMIT = 50

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
/** Sums of MXN amounts pick up float noise; two decimals is the currency. */
const money = (v: number) => Math.round(v * 100) / 100

/**
 * Digested receivable block shared by the customer profile and the ranking. Odoo's ledger
 * balance: NET of credit notes and in company currency — never to be squared against the gross
 * per-invoice figures (#102).
 */
export function receivableBlock(p: Record<string, unknown>) {
  const dso = num(p.days_sales_outstanding)
  return {
    deuda_total: num(p.total_due),
    vencido: num(p.total_overdue),
    dias_promedio_de_pago: dso === null ? null : Math.round(dso),
  }
}

export const CARTERA_NOTA =
  'Saldo contable de Odoo: neto de notas de crédito y en moneda de la compañía — no lo cuadres contra facturacion.total_pendiente ni facturas_vencidas (brutos por factura), ni le restes notas de crédito otra vez.'

export async function odooReceivablesRanking(odoo: OdooCaller, input: { limit?: number } = {}) {
  const limit = Math.min(MAX_LIMIT, Math.max(1, Math.floor(input.limit ?? DEFAULT_LIMIT)))

  const domain = [['customer_rank', '>', 0]]
  const partners: Record<string, unknown>[] = []
  let pages = 0
  let total: number | null = null
  for (;;) {
    const page = normalizeRecords(
      await odoo('res.partner', 'search_read', {
        domain,
        fields: ['name', 'total_due', 'total_overdue', 'days_sales_outstanding'],
        limit: PAGE,
        offset: pages * PAGE,
        order: 'customer_rank desc, id asc',
      }),
    )
    pages += 1
    partners.push(...page)
    if (page.length < PAGE) break
    if (pages >= MAX_PAGES) {
      // A full last page is not proof of more: one count says whether anyone was left out.
      total = Number(await odoo('res.partner', 'search_count', { domain }))
      break
    }
  }
  const truncated = total !== null && (!Number.isFinite(total) || total > partners.length)

  const withBalance = partners
    .map((p) => ({ cliente: (p.name as string | null) ?? 'Sin nombre', ...receivableBlock(p) }))
    .filter((c) => (c.deuda_total ?? 0) > 0)

  const byOverdue = [...withBalance].sort(
    (a, b) => (b.vencido ?? 0) - (a.vencido ?? 0) || (b.deuda_total ?? 0) - (a.deuda_total ?? 0),
  )
  const bySlowness = withBalance
    .filter((c) => c.dias_promedio_de_pago !== null)
    .sort((a, b) => (b.dias_promedio_de_pago ?? 0) - (a.dias_promedio_de_pago ?? 0))

  return {
    // Partners with a balance but no customer rank (manual invoices) are outside this universe.
    universo: 'clientes de Odoo (customer_rank > 0) con saldo; cifras contables netas de notas de crédito',
    clientes_con_saldo: withBalance.length,
    deuda_total: money(withBalance.reduce((sum, c) => sum + (c.deuda_total ?? 0), 0)),
    vencido_total: money(withBalance.reduce((sum, c) => sum + (c.vencido ?? 0), 0)),
    // Who to collect from first: overdue amount, then total owed.
    por_vencido: byOverdue.slice(0, limit),
    // Who pays slowest: Odoo's DSO, averaged over the customer's history.
    mas_lentos: bySlowness.slice(0, limit).map((c) => ({ cliente: c.cliente, dias_promedio_de_pago: c.dias_promedio_de_pago, deuda_total: c.deuda_total })),
    llamadas: pages + (total !== null ? 1 : 0),
    nota: truncated
      ? `Ranking sobre ${partners.length} clientes leídos${Number.isFinite(total) ? ` de ${total}` : ''} — puede faltar alguno de menor relevancia.`
      : null,
  }
}
