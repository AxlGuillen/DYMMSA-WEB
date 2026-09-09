/** The MCP's BOUNDARY (ADR-025): allowed models and fields, filters and order included. Payroll and salaries NEVER enter. */

import { OdooError } from './client'

export interface CatalogEntry {
  /** For error messages and tool descriptions. */
  label: string
  fields: readonly string[]
  /** Readable but banned in domains/order: Odoo filters computed fields by returning 0 SILENTLY (ADR-025). */
  readOnlyFields?: readonly string[]
}

export const ODOO_CATALOG: Record<string, CatalogEntry> = {
  'account.move': {
    label: 'Facturas (documentos contables)',
    fields: [
      'name', 'partner_id', 'move_type', 'invoice_date', 'invoice_date_due',
      'amount_untaxed', 'amount_total', 'amount_residual', 'payment_state',
      'state', 'currency_id', 'invoice_origin', 'ref',
      // CFDI stamping: verified against the real instance (Mexican localization, fields carry data).
      'l10n_mx_edi_cfdi_uuid', 'l10n_mx_edi_cfdi_state', 'l10n_mx_edi_cfdi_sat_state',
      // PUE/PPD payment policy (stored): PUE requires no REP.
      'l10n_mx_edi_payment_policy',
    ],
  },
  'account.payment': {
    label: 'Pagos',
    fields: ['name', 'partner_id', 'date', 'amount', 'payment_type', 'state', 'memo', 'currency_id'],
    // A payment's l10n_mx_edi_* stay out: they compute `false` even on payments with a stamped
    // REP (verified 2026-08-20 with PAY00068) — the REP truth is l10n_mx_edi.document.
    readOnlyFields: ['reconciled_invoice_ids'],
  },

  // Odoo 19: res.partner no longer has `mobile` (folded into phone) — verified on the real instance.
  'res.partner': {
    label: 'Contactos (clientes y proveedores)',
    fields: ['name', 'email', 'phone', 'vat', 'city', 'country_id', 'customer_rank', 'supplier_rank'],
  },
  'sale.order': {
    label: 'Órdenes de venta',
    // date_order is a DATETIME ("YYYY-MM-DD HH:MM:SS"), not a date.
    fields: ['name', 'partner_id', 'date_order', 'amount_untaxed', 'amount_total', 'state', 'invoice_status', 'user_id'],
  },

  // Odoo's warehouse, NOT the DYMMSA-WEB store. qty_available is out on purpose:
  // computed and not stored — the truth is stock.quant.
  'product.product': {
    label: 'Productos (catálogo de Odoo)',
    fields: ['name', 'default_code', 'list_price', 'standard_price', 'categ_id', 'uom_id'],
  },
  'stock.quant': {
    label: 'Existencias por ubicación (almacén de Odoo)',
    fields: ['product_id', 'location_id', 'quantity', 'available_quantity'],
  },

  // hr.employee: work directory ONLY. Payroll, salaries and personal data (bank, CURP,
  // birth date) never enter this whitelist.
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

  // Document lines: the curated tools resolve folio → id and filter by the numeric FK (no traversal).
  'account.move.line': {
    label: 'Líneas de factura',
    fields: ['move_id', 'name', 'product_id', 'quantity', 'price_unit', 'price_subtotal', 'price_total', 'display_type'],
  },
  'sale.order.line': {
    label: 'Líneas de orden de venta',
    fields: ['order_id', 'name', 'product_id', 'product_uom_qty', 'qty_delivered', 'qty_invoiced', 'price_unit', 'price_subtotal', 'display_type'],
  },

  // REP complements: the truth of payment stamping, all stored (ADR-025).
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

/** readOnly fields stay out of the default projection but are valid when explicitly requested. */
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

/** Simplified Odoo domain: only [field, operator, value] triples, implicit AND. */
export type DomainTriple = [string, string, unknown]

export function assertDomainAllowed(model: string, domain: DomainTriple[]): void {
  const entry = catalogEntry(model)
  for (const [field] of domain) {
    // Traversal ("partner_id.vat") is banned: filtering by a hidden field is an inference oracle (PR #66).
    if (field.includes('.')) {
      throw new OdooError(
        `No se puede filtrar ${model} por "${field}": el traversal por relación no está permitido — filtra por el campo base (p. ej. partner_id con ilike).`,
      )
    }
    // `invoice_date:month` (group granularity) validates against the base field.
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
