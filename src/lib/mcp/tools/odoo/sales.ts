/**
 * Bloque Odoo — Fase 2: Contactos + Ventas (issue #65, ADR-025). SOLO lectura.
 *
 * Mismo contrato que accounting.ts: caller inyectado, catálogo como frontera,
 * respuestas digeridas. `sale.order.date_order` es DATETIME — los rangos de
 * fecha se expanden a los extremos del día para no perder registros.
 */

import type { OdooCaller } from '@/lib/odoo/client'
import type { DomainTriple } from '@/lib/odoo/catalog'
import { daysSince, normalizeGroups, normalizeRecord, normalizeRecords, todayIso } from '@/lib/odoo/normalize'
import { ToolError } from '../../shared'
import { overdueDomain } from './accounting'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function assertDate(date: string | undefined): void {
  if (date && !DATE_RE.test(date)) throw new ToolError(`Fecha inválida "${date}" — usa YYYY-MM-DD`)
}

// ── odoo_sales_summary ─────────────────────────────────────────────────

export interface SalesSummaryInput {
  date_from?: string
  date_to?: string
  group_by?: 'estado' | 'cliente' | 'vendedor' | 'mes'
  /** confirmadas (default): solo sale/done. todas: incluye cotizaciones draft/sent. */
  incluir?: 'confirmadas' | 'todas'
}

const SALES_GROUP_FIELD: Record<NonNullable<SalesSummaryInput['group_by']>, string> = {
  estado: 'state',
  cliente: 'partner_id',
  vendedor: 'user_id',
  mes: 'date_order:month',
}

export async function odooSalesSummary(odoo: OdooCaller, input: SalesSummaryInput = {}) {
  assertDate(input.date_from)
  assertDate(input.date_to)

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

// ── odoo_customer_profile ──────────────────────────────────────────────

const PARTNER_FIELDS = ['name', 'email', 'phone', 'vat', 'city', 'country_id', 'customer_rank']

export async function odooCustomerProfile(odoo: OdooCaller, input: { cliente: string }) {
  const query = input.cliente?.trim()
  if (!query) throw new ToolError('Indica el nombre (o parte del nombre) del cliente')

  const matches = normalizeRecords(
    await odoo('res.partner', 'search_read', {
      domain: [['name', 'ilike', query]],
      fields: PARTNER_FIELDS,
      limit: 5,
      order: 'customer_rank desc',
    }),
  )
  if (matches.length === 0) {
    return {
      encontrado: false as const,
      mensaje: `Ningún contacto en Odoo coincide con "${query}"`,
      coincidencias: [] as unknown[],
    }
  }
  if (matches.length > 1) {
    return {
      encontrado: false as const,
      mensaje: `Hay ${matches.length} coincidencias — precisa el nombre`,
      coincidencias: matches.map((m) => m.name),
    }
  }

  const partner = matches[0]
  const partnerId = partner.id as number

  // 3 llamadas más (la cola las seria): ventas, facturación y vencidas del cliente.
  const ventas = normalizeGroups(
    await odoo('sale.order', 'read_group', {
      domain: [['partner_id', '=', partnerId]],
      fields: ['amount_total:sum'],
      groupby: ['state'],
    }),
  )
  const facturacion = normalizeGroups(
    await odoo('account.move', 'read_group', {
      domain: [['partner_id', '=', partnerId], ['move_type', '=', 'out_invoice'], ['state', '=', 'posted']],
      fields: ['amount_total:sum', 'amount_residual:sum'],
      groupby: ['payment_state'],
    }),
  )
  const vencidas = normalizeRecords(
    await odoo('account.move', 'search_read', {
      domain: [...overdueDomain(todayIso()), ['partner_id', '=', partnerId]],
      fields: ['name', 'invoice_date_due', 'amount_residual'],
      limit: 5,
      order: 'invoice_date_due asc',
    }),
  )

  // Las draft/sent de Odoo son cotizaciones, no ventas: el total solo suma
  // confirmadas — el desglose por_estado conserva todo para contexto.
  const CONFIRMED = new Set(['sale', 'done'])
  return {
    encontrado: true as const,
    cliente: normalizeRecord(partner),
    ventas: {
      total_confirmado: ventas
        .filter((g) => CONFIRMED.has(g.state as string))
        .reduce((sum, g) => sum + ((g.amount_total as number) ?? 0), 0),
      por_estado: ventas,
    },
    facturacion: {
      total_facturado: facturacion.reduce((sum, g) => sum + ((g.amount_total as number) ?? 0), 0),
      total_pendiente: facturacion.reduce((sum, g) => sum + ((g.amount_residual as number) ?? 0), 0),
      por_estado_pago: facturacion,
    },
    facturas_vencidas: vencidas.map((inv) => ({
      folio: inv.name,
      vencio: inv.invoice_date_due,
      dias_vencida: typeof inv.invoice_date_due === 'string' ? daysSince(inv.invoice_date_due) : null,
      monto_pendiente: inv.amount_residual,
    })),
  }
}
