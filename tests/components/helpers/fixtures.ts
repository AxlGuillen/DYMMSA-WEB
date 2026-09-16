/** UI-shaped fixtures; tests/helpers/factories.ts holds the API payload ones. */

import type {
  QuotationItemRow,
  QuotationItem,
  QuotationWithItems,
  EtmProduct,
} from '@/types/database'

let seq = 0
const uid = (prefix: string) => `${prefix}-${++seq}`

/** Editable product row (local state of the quoter / detail). */
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

/** Editable separator row. */
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

/** Quotation item with the DB shape (for QuotationWithItems). */
export function quotationItem(overrides: Partial<QuotationItem> = {}): QuotationItem {
  return {
    id: uid('qi'),
    quotation_id: 'q1',
    item_type: 'product',
    section_label: null,
    separator_color: null,
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

/** Quotation with items (QuotationDetail prop). */
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

/** Catalog product (for QuotePreview). */
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
