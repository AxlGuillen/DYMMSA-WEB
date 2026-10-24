/** Odoo phase 2 — sales (ADR-025). date_order is a DATETIME: ranges expand to day bounds so records aren't lost. */

import type { OdooCaller } from '@/lib/odoo/client'
import type { DomainTriple } from '@/lib/odoo/catalog'
import { normalizeGroups } from '@/lib/odoo/normalize'
import { assertDateRange } from './dates'

export interface SummarizeSalesInput {
  date_from?: string
  date_to?: string
  group_by?: 'estado' | 'cliente' | 'vendedor' | 'mes'
  /** confirmadas (default): sale/done only. todas: also draft/sent quotations. */
  incluir?: 'confirmadas' | 'todas'
}

const SALES_GROUP_FIELD: Record<NonNullable<SummarizeSalesInput['group_by']>, string> = {
  estado: 'state',
  cliente: 'partner_id',
  vendedor: 'user_id',
  mes: 'date_order:month',
}

export async function odooSummarizeSales(odoo: OdooCaller, input: SummarizeSalesInput = {}) {
  assertDateRange(input.date_from, input.date_to)

  const incluir = input.incluir ?? 'confirmadas'
  const domain: DomainTriple[] = [
    ...(incluir === 'confirmadas'
      ? [['state', 'in', ['sale', 'done']] as DomainTriple]
      : [['state', '!=', 'cancel'] as DomainTriple]),
    ...(input.date_from ? [['date_order', '>=', `${input.date_from} 00:00:00`] as DomainTriple] : []),
    ...(input.date_to ? [['date_order', '<=', `${input.date_to} 23:59:59`] as DomainTriple] : []),
  ]

  const grupos = normalizeGroups(
    await odoo('sale.order', 'read_group', {
      domain,
      fields: ['amount_untaxed:sum', 'amount_total:sum'],
      groupby: [SALES_GROUP_FIELD[input.group_by ?? 'estado']],
    }),
  )

  return {
    periodo: { desde: input.date_from ?? 'inicio', hasta: input.date_to ?? 'hoy' },
    incluye: incluir === 'confirmadas' ? 'solo ventas confirmadas (sale/done)' : 'todo menos canceladas',
    agrupado_por: input.group_by ?? 'estado',
    total_ventas: grupos.reduce((sum, g) => sum + ((g.amount_total as number) ?? 0), 0),
    ordenes: grupos.reduce((sum, g) => sum + ((g.count as number) ?? 0), 0),
    grupos,
  }
}
