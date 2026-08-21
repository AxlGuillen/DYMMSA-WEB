/**
 * Catálogo Odoo = la FRONTERA del MCP (ADR-025): modelos y campos permitidos,
 * también en filtros/order. Nómina y salarios JAMÁS entran.
 */

import { OdooError } from './client'

export interface CatalogEntry {
  /** Para mensajes de error y descripciones de tools. */
  label: string
  fields: readonly string[]
  /** Legibles pero vedados en dominios/order: Odoo filtra computados devolviendo 0 EN SILENCIO (ADR-025 F6). */
  readOnlyFields?: readonly string[]
}

export const ODOO_CATALOG: Record<string, CatalogEntry> = {
  // ── Fase 1 — Contabilidad ────────────────────────────────────────────
  'account.move': {
    label: 'Facturas (documentos contables)',
    fields: [
      'name', 'partner_id', 'move_type', 'invoice_date', 'invoice_date_due',
      'amount_untaxed', 'amount_total', 'amount_residual', 'payment_state',
      'state', 'currency_id', 'invoice_origin', 'ref',
      // Timbrado CFDI (Fase 5) — verificado que la instancia usa la
      // localización mexicana y estos campos traen datos reales.
      'l10n_mx_edi_cfdi_uuid', 'l10n_mx_edi_cfdi_state', 'l10n_mx_edi_cfdi_sat_state',
      // Política de pago PUE/PPD (Fase 6, almacenado): PUE no exige REP.
      'l10n_mx_edi_payment_policy',
    ],
  },
  'account.payment': {
    label: 'Pagos',
    fields: ['name', 'partner_id', 'date', 'amount', 'payment_type', 'state', 'memo'],
    // Fase 6: el desglose pago→facturas. Los l10n_mx_edi_* del pago NO entran:
    // computan `false` incluso en pagos con REP timbrado (verificado 2026-08-20
    // con PAY00068) — la verdad del REP es l10n_mx_edi.document.
    readOnlyFields: ['reconciled_invoice_ids'],
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

  // ── Fase 3 — Inventario (almacén de Odoo, NO la tienda DYMMSA-WEB) ───
  // qty_available fuera a propósito: computado no-almacenado (la verdad es stock.quant).
  'product.product': {
    label: 'Productos (catálogo de Odoo)',
    fields: ['name', 'default_code', 'list_price', 'standard_price', 'categ_id', 'uom_id'],
  },
  'stock.quant': {
    label: 'Existencias por ubicación (almacén de Odoo)',
    fields: ['product_id', 'location_id', 'quantity', 'available_quantity'],
  },

  // ── Fase 4 — Empleados + Flotilla ────────────────────────────────────
  // hr.employee: SOLO directorio laboral. Nómina/salarios/datos personales
  // (banco, CURP, fecha de nacimiento) jamás entran a esta whitelist.
  'hr.employee': {
    label: 'Empleados (directorio laboral)',
    fields: ['name', 'job_title', 'department_id', 'work_email', 'work_phone'],
  },
  'fleet.vehicle': {
    label: 'Flotilla (vehículos)',
    fields: ['name', 'license_plate', 'driver_id', 'odometer', 'odometer_unit', 'model_id', 'state_id'],
  },
  'fleet.vehicle.log.services': {
    label: 'Bitácora de servicios de flotilla',
    fields: ['vehicle_id', 'service_type_id', 'date', 'amount', 'state', 'description'],
  },

  // ── Fase 5 — Líneas de documento ─────────────────────────────────────
  // Habilitan "¿qué productos trae la factura/venta X?". Las tools curadas
  // resuelven el folio → id y filtran por la FK numérica (sin traversal).
  'account.move.line': {
    label: 'Líneas de factura',
    fields: ['move_id', 'name', 'product_id', 'quantity', 'price_unit', 'price_subtotal', 'price_total', 'display_type'],
  },
  'sale.order.line': {
    label: 'Líneas de orden de venta',
    fields: ['order_id', 'name', 'product_id', 'product_uom_qty', 'qty_delivered', 'qty_invoiced', 'price_unit', 'price_subtotal', 'display_type'],
  },

  // ── Fase 6 — Complementos de pago (REP) ──────────────────────────────
  // La verdad del timbrado de pagos, todo almacenado (ADR-025 F6).
  'l10n_mx_edi.document': {
    label: 'Documentos CFDI (timbrado de facturas y complementos de pago REP)',
    fields: ['move_id', 'invoice_ids', 'state', 'sat_state', 'attachment_uuid', 'datetime', 'message', 'cancellation_reason'],
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

/**
 * Sin `requested` devuelve la whitelist base (los readOnly no entran a la
 * proyección por defecto); con él, valida cada campo — readOnly incluidos.
 */
export function allowedFields(model: string, requested?: string[]): string[] {
  const entry = catalogEntry(model)
  if (!requested || requested.length === 0) return [...entry.fields]
  const readable = [...entry.fields, ...(entry.readOnlyFields ?? [])]
  for (const field of requested) {
    if (!readable.includes(field)) {
      throw new OdooError(`El campo "${field}" de ${model} no está en el catálogo. Permitidos: ${readable.join(', ')}`)
    }
  }
  return requested
}

/** Dominio Odoo simplificado: solo tripletas [campo, operador, valor] (AND implícito). */
export type DomainTriple = [string, string, unknown]

export function assertDomainAllowed(model: string, domain: DomainTriple[]): void {
  const entry = catalogEntry(model)
  for (const [field] of domain) {
    // Traversal ("partner_id.vat") vedado: filtrar por campo oculto es un oracle de inferencia (PR #66).
    if (field.includes('.')) {
      throw new OdooError(
        `No se puede filtrar ${model} por "${field}": el traversal por relación no está permitido — filtra por el campo base (p. ej. partner_id con ilike).`,
      )
    }
    // `invoice_date:month` (granularidad de agrupación) valida el campo base.
    const base = field.split(':')[0]
    if (entry.readOnlyFields?.includes(base)) {
      throw new OdooError(
        `No se puede filtrar ni ordenar ${model} por "${base}": es un campo computado solo de lectura — Odoo devolvería 0 resultados en silencio.`,
      )
    }
    if (base !== 'id' && !entry.fields.includes(base)) {
      throw new OdooError(`No se puede filtrar ${model} por "${field}": el campo no está en el catálogo.`)
    }
  }
}
