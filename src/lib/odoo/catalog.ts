/**
 * Catálogo del bloque Odoo (ADR-025): la FRONTERA de lo que el MCP puede ver.
 *
 * Las primitivas genéricas (odoo_query / odoo_aggregate) solo aceptan modelos
 * listados aquí, y de cada modelo solo los campos de su whitelist — también en
 * los filtros (un dominio sobre un campo oculto filtraría información que no
 * se puede leer). Agregar un módulo de Odoo = agregar entradas aquí.
 *
 * Regla permanente: datos sensibles (nómina, salarios) NUNCA entran al
 * catálogo, aunque la API key del server tenga permiso de leerlos.
 */

import { OdooError } from './client'

export interface CatalogEntry {
  /** Para mensajes de error y descripciones de tools. */
  label: string
  fields: readonly string[]
}

export const ODOO_CATALOG: Record<string, CatalogEntry> = {
  // ── Fase 1 — Contabilidad ────────────────────────────────────────────
  'account.move': {
    label: 'Facturas (documentos contables)',
    fields: [
      'name', 'partner_id', 'move_type', 'invoice_date', 'invoice_date_due',
      'amount_untaxed', 'amount_total', 'amount_residual', 'payment_state',
      'state', 'currency_id', 'invoice_origin', 'ref',
    ],
  },
  'account.payment': {
    label: 'Pagos',
    fields: ['name', 'partner_id', 'date', 'amount', 'payment_type', 'state', 'memo'],
  },

  // ── Fase 2 — Contactos + Ventas ──────────────────────────────────────
  // Ojo Odoo 19: res.partner ya NO tiene `mobile` (consolidado en phone) —
  // verificado contra la instancia real (2026-08-11).
  'res.partner': {
    label: 'Contactos (clientes y proveedores)',
    fields: ['name', 'email', 'phone', 'vat', 'city', 'country_id', 'customer_rank', 'supplier_rank'],
  },
  'sale.order': {
    label: 'Órdenes de venta',
    // date_order es DATETIME ("YYYY-MM-DD HH:MM:SS"), no date.
    fields: ['name', 'partner_id', 'date_order', 'amount_untaxed', 'amount_total', 'state', 'invoice_status', 'user_id'],
  },
}

export function catalogEntry(model: string): CatalogEntry {
  const entry = ODOO_CATALOG[model]
  if (!entry) {
    const available = Object.keys(ODOO_CATALOG).join(', ')
    throw new OdooError(`El modelo "${model}" no está en el catálogo Odoo del MCP. Disponibles: ${available}`)
  }
  return entry
}

/** Sin `requested` devuelve la whitelist completa; con él, valida cada campo. */
export function allowedFields(model: string, requested?: string[]): string[] {
  const entry = catalogEntry(model)
  if (!requested || requested.length === 0) return [...entry.fields]
  for (const field of requested) {
    if (!entry.fields.includes(field)) {
      throw new OdooError(`El campo "${field}" de ${model} no está en el catálogo. Permitidos: ${entry.fields.join(', ')}`)
    }
  }
  return requested
}

/** Dominio Odoo simplificado: solo tripletas [campo, operador, valor] (AND implícito). */
export type DomainTriple = [string, string, unknown]

export function assertDomainAllowed(model: string, domain: DomainTriple[]): void {
  const entry = catalogEntry(model)
  for (const [field] of domain) {
    // `invoice_date:month` o `partner_id.name` → valida el campo base; `id` siempre pasa.
    const base = field.split(/[.:]/)[0]
    if (base !== 'id' && !entry.fields.includes(base)) {
      throw new OdooError(`No se puede filtrar ${model} por "${field}": el campo no está en el catálogo.`)
    }
  }
}
