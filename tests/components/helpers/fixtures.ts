/**
 * Fixtures con el shape de la UI (distintas a tests/helpers/factories.ts, que
 * son payloads de API). Builders para QuotationItemRow, QuotationItem,
 * QuotationWithItems y EtmProduct.
 */

import type {
  QuotationItemRow,
  QuotationItem,
  QuotationWithItems,
  EtmProduct,
} from '@/types/database'

let seq = 0
const uid = (prefix: string) => `${prefix}-${++seq}`

/** Fila editable de producto (estado local del cotizador / detalle). */
export function quotationItemRow(overrides: Partial<QuotationItemRow> = {}): QuotationItemRow {
  return {
    _id: uid('row'),
    item_type: 'product',
    section_label: '',
    etm: 'ETM-1',
    description: 'Producto de prueba',
    description_es: 'Producto de prueba',
    model_code: 'MC1',
    brand: 'URREA',
    unit_price: 100,
    quantity: 2,
    delivery_time: 'immediate',
    _inDb: true,
    is_approved: null,
    ...overrides,
  }
}

/** Fila separadora editable. */
export function separatorRow(overrides: Partial<QuotationItemRow> = {}): QuotationItemRow {
  return quotationItemRow({
    item_type: 'separator',
    section_label: 'Sección A',
    etm: '',
    description: '',
    description_es: '',
    model_code: '',
    brand: '',
    unit_price: null,
    quantity: null,
    _inDb: false,
    ...overrides,
  })
}

/** Item de cotización con shape de BD (para QuotationWithItems). */
export function quotationItem(overrides: Partial<QuotationItem> = {}): QuotationItem {
  return {
    id: uid('qi'),
    quotation_id: 'q1',
    item_type: 'product',
    section_label: null,
    etm: 'ETM-1',
    description: 'Producto',
    description_es: 'Producto',
    model_code: 'MC1',
    brand: 'URREA',
    unit_price: 100,
    quantity: 2,
    is_approved: null,
    notes: null,
    delivery_time: 'immediate',
    sort_order: 0,
    created_at: '2026-05-01T00:00:00Z',
    ...overrides,
  }
}

/** Cotización con items (prop de QuotationDetail). */
export function quotationWithItems(
  overrides: Partial<QuotationWithItems> = {},
): QuotationWithItems {
  return {
    id: 'q1',
    name: 'Cotización de prueba',
    customer_name: 'ACME',
    status: 'approved',
    approval_token: 'tok-1',
    total_amount: 0,
    notes: null,
    original_file_url: null,
    created_at: '2026-05-01T00:00:00Z',
    updated_at: '2026-05-01T00:00:00Z',
    created_by: 'user-1',
    quotation_items: [quotationItem()],
    ...overrides,
  }
}

/** Producto de catálogo (para QuotePreview). */
export function etmProduct(overrides: Partial<EtmProduct> = {}): EtmProduct {
  return {
    id: uid('etm'),
    etm: 'ETM-1',
    description: 'Producto',
    description_es: 'Producto',
    model_code: 'MC1',
    price: 100,
    brand: 'URREA',
    created_at: '2026-05-01T00:00:00Z',
    updated_at: '2026-05-01T00:00:00Z',
    created_by: 'user-1',
    ...overrides,
  }
}
