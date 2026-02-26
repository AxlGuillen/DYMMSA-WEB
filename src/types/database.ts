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
