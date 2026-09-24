/**
 * Odoo phase 8 (#113): the customer's receivable figures as Odoo computes them — total_due,
 * total_overdue and DSO (average days to pay). Computed and not stored, so the ranking reads
 * every customer and orders in memory; no domain or order on these fields ever reaches Odoo.
 */

import type { OdooCaller } from '@/lib/odoo/client'
import { normalizeRecords } from '@/lib/odoo/normalize'

const PAGE = 200
const MAX_PAGES = 5
const DEFAULT_LIMIT = 10
const MAX_LIMIT = 50

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
/** Sums of MXN amounts pick up float noise; two decimals is the currency. */
const money = (v: number) => Math.round(v * 100) / 100

/** Digested receivable block shared by the customer profile and the ranking. */
export function receivableBlock(p: Record<string, unknown>) {
  const dso = num(p.days_sales_outstanding)
  return {
    deuda_total: num(p.total_due),
    vencido: num(p.total_overdue),
    por_cobrar: num(p.credit),
    dias_promedio_de_pago: dso === null ? null : Math.round(dso),
  }
}

export async function odooReceivablesRanking(odoo: OdooCaller, input: { limit?: number } = {}) {
  const limit = Math.min(MAX_LIMIT, Math.max(1, Math.floor(input.limit ?? DEFAULT_LIMIT)))

  const partners: Record<string, unknown>[] = []
  let pages = 0
  for (;;) {
    const page = normalizeRecords(
      await odoo('res.partner', 'search_read', {
        domain: [['customer_rank', '>', 0]],
        fields: ['name', 'total_due', 'total_overdue', 'days_sales_outstanding'],
        limit: PAGE,
        offset: pages * PAGE,
        order: 'customer_rank desc, id asc',
      }),
    )
    pages += 1
    partners.push(...page)
    if (page.length < PAGE || pages >= MAX_PAGES) break
  }
  const truncated = pages >= MAX_PAGES && partners.length === PAGE * MAX_PAGES

  // credit is not requested here (≈ total_due): the row carries only what the ranking reads.
  const withBalance = partners
    .map((p) => {
      const { deuda_total, vencido, dias_promedio_de_pago } = receivableBlock(p)
      return { cliente: p.name as string, deuda_total, vencido, dias_promedio_de_pago }
    })
    .filter((c) => (c.deuda_total ?? 0) > 0)

  const byOverdue = [...withBalance].sort(
    (a, b) => (b.vencido ?? 0) - (a.vencido ?? 0) || (b.deuda_total ?? 0) - (a.deuda_total ?? 0),
  )
  const bySlowness = withBalance
    .filter((c) => c.dias_promedio_de_pago !== null)
    .sort((a, b) => (b.dias_promedio_de_pago ?? 0) - (a.dias_promedio_de_pago ?? 0))

  return {
    clientes_con_saldo: withBalance.length,
    deuda_total: money(withBalance.reduce((sum, c) => sum + (c.deuda_total ?? 0), 0)),
    vencido_total: money(withBalance.reduce((sum, c) => sum + (c.vencido ?? 0), 0)),
    // Who to collect from first: overdue amount, then total owed.
    por_vencido: byOverdue.slice(0, limit),
    // Who pays slowest: Odoo's DSO, averaged over the customer's history.
    mas_lentos: bySlowness.slice(0, limit).map((c) => ({ cliente: c.cliente, dias_promedio_de_pago: c.dias_promedio_de_pago, deuda_total: c.deuda_total })),
    llamadas: pages,
    nota: truncated ? `Ranking sobre los primeros ${PAGE * MAX_PAGES} clientes por relevancia; puede faltar alguno.` : null,
  }
}
