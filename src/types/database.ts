// Database types for DYMMSA - matches Supabase schema

export interface EtmProduct {
  id: string
  etm: string
  description: string
  description_es: string
  model_code: string
  price: number
  brand: string
  created_at: string
  updated_at: string
  created_by: string | null
}

// Insert types (without auto-generated fields)
export type EtmProductInsert = Omit<EtmProduct, 'id' | 'created_at' | 'updated_at'>
export type EtmProductUpdate = Partial<Omit<EtmProduct, 'id' | 'created_at' | 'updated_at'>>

// Excel row type for import
export interface ExcelProductRow {
  ETM: string
  DESCRIPTION: string
  DESCRIPTION_ES: string
  MODEL_CODE: string
  PRICE: number | string
  BRAND?: string
}

// Store Inventory
export interface StoreInventory {
  id: string
  model_code: string
  quantity: number
  updated_at: string
}

export type StoreInventoryInsert = Omit<StoreInventory, 'id' | 'updated_at'>
export type StoreInventoryUpdate = Partial<Omit<StoreInventory, 'id' | 'updated_at'>>

// Excel row type for inventory import
export interface ExcelInventoryRow {
  MODEL_CODE: string
  QUANTITY: number | string
}

// ============================================
// ORDERS SYSTEM
// ============================================

export type OrderStatus =
  | 'pending_urrea_order'
  | 'received_from_urrea'
  | 'pending_payment'
  | 'paid'
  | 'completed'
  | 'cancelled'

export type UrreaStatus = 'pending' | 'supplied' | 'not_supplied'

export interface Order {
  id: string
  customer_name: string
  status: OrderStatus
  total_amount: number
  original_file_url: string | null
  urrea_order_file_url: string | null
  notes: string | null
  created_at: string
  updated_at: string
  created_by: string | null
}

export type OrderInsert = Omit<Order, 'id' | 'created_at' | 'updated_at'>
export type OrderUpdate = Partial<Omit<Order, 'id' | 'created_at' | 'updated_at'>>

export interface OrderItem {
  id: string
  order_id: string
  etm: string
  model_code: string
  description: string
  brand: string
  quantity_approved: number
  quantity_in_stock: number
  quantity_to_order: number
  quantity_received: number
  urrea_status: UrreaStatus
  unit_price: number
  created_at: string
}

export type OrderItemInsert = Omit<OrderItem, 'id' | 'created_at'>
export type OrderItemUpdate = Partial<Omit<OrderItem, 'id' | 'created_at' | 'order_id'>>

// Order with items for detail view
export interface OrderWithItems extends Order {
  order_items: OrderItem[]
}

// Approved product from Excel (detected green rows)
export interface ApprovedProduct {
  etm: string
  description: string
  description_es: string
  model_code: string
  quantity: number
  price: number
  brand: string
}

// Create order input
export interface CreateOrderInput {
  customer_name: string
  products: ApprovedProduct[]
}

// Confirm reception input
export interface ConfirmReceptionInput {
  items: {
    id: string
    quantity_received: number
    urrea_status: UrreaStatus
  }[]
}

// Auto-learn result
export interface AutoLearnResult {
  added: number
  skipped: number
  existing: number
}

// ============================================
// QUOTATIONS SYSTEM
// ============================================

export type QuotationStatus =
  | 'draft'
  | 'sent_for_approval'
  | 'approved'
  | 'rejected'
  | 'converted_to_order'

export interface Quotation {
  id: string
  customer_name: string
  status: QuotationStatus
  approval_token: string
  total_amount: number
  notes: string | null
  original_file_url: string | null
  created_at: string
  updated_at: string
  created_by: string | null
}

export type QuotationInsert = Omit<Quotation, 'id' | 'created_at' | 'updated_at' | 'approval_token'>
export type QuotationUpdate = Partial<Omit<Quotation, 'id' | 'created_at' | 'updated_at'>>

export interface QuotationItem {
  id: string
  quotation_id: string
  etm: string | null
  description: string | null
  description_es: string | null
  model_code: string | null
  brand: string | null
  unit_price: number | null
  quantity: number | null
  is_approved: boolean | null
  notes: string | null
  created_at: string
}

export interface QuotationWithItems extends Quotation {
  quotation_items: QuotationItem[]
}

// Row in the editable quotation table (local/draft state, not saved to DB yet)
export interface QuotationItemRow {
  _id: string        // local UUID used as React key
  etm: string        // required, read-only in edit mode
  description: string
  description_es: string
  model_code: string
  brand: string
  unit_price: number | null
  quantity: number | null
  _inDb: boolean     // true if ETM was matched in etm_products
}

// Raw row extracted from Excel before DB lookup
export interface ExcelExtractedRow {
  etm: string
  description: string
  description_es: string
  model_code: string
  quantity: number | null
  price: number | null
  brand: string
}
