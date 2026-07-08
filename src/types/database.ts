// Database types for DYMMSA - matches Supabase schema

export interface EtmProduct {
  id: string
  etm: string
  description: string
  description_es: string
  // Descripción curada por DYMMSA. Se mantiene vacía para productos con match
  // en urrea_catalog: la oficial del catálogo tiene jerarquía mayor y se
  // resuelve en lectura (nunca se copia aquí).
  dymmsa_description: string | null
  model_code: string
  price: number
  brand: string
  is_sold: boolean | null // tri-state: null = sin definir, true = lo vendemos, false = no lo vendemos
  created_at: string
  updated_at: string
  created_by: string | null
}

// Insert types (without auto-generated fields). is_sold y dymmsa_description son
// opcionales: las columnas admiten NULL por defecto, así que los inserts que no
// las especifican son válidos.
export type EtmProductInsert =
  Omit<EtmProduct, 'id' | 'created_at' | 'updated_at' | 'is_sold' | 'dymmsa_description'> &
  { is_sold?: boolean | null; dymmsa_description?: string | null }
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
  location: string | null // ubicación física (gaveta), texto libre; se conserva aunque quantity=0
  updated_at: string
}

// location es opcional en el insert (columna nullable en BD).
export type StoreInventoryInsert =
  Omit<StoreInventory, 'id' | 'updated_at' | 'location'> & { location?: string | null }
export type StoreInventoryUpdate = Partial<Omit<StoreInventory, 'id' | 'updated_at'>>

// URREA Catalog (tabla aislada — sin relaciones con etm_products/órdenes por ahora)
export interface UrreaCatalogItem {
  id: string
  code: string
  description: string | null
  std: number
  price: number | null
  created_at: string
  updated_at: string
}

export type UrreaCatalogInsert = Omit<UrreaCatalogItem, 'id' | 'created_at' | 'updated_at'>
export type UrreaCatalogUpdate = Partial<UrreaCatalogInsert>

// Excel row type for inventory import
export interface ExcelInventoryRow {
  MODEL_CODE: string
  QUANTITY: number | string
}

// ============================================
// ORDERS SYSTEM
// ============================================

export type OrderStatus =
  | 'ordered'
  | 'received'
  | 'delivered'
  | 'completed'
  | 'cancelled'

export type UrreaStatus = 'pending' | 'supplied' | 'not_supplied'

export type DeliveryTime =
  | 'immediate'
  | '2_3_days'
  | '3_5_days'
  | '1_week'
  | '2_weeks'
  | 'indefinite'

export interface Order {
  id: string
  quotation_id: string | null
  name: string
  customer_name: string
  status: OrderStatus
  total_amount: number
  original_file_url: string | null
  urrea_order_file_url: string | null
  notes: string | null
  odoo_id: string | null
  created_at: string
  updated_at: string
  created_by: string | null
}

export type OrderInsert = Omit<Order, 'id' | 'created_at' | 'updated_at'>
export type OrderUpdate = Partial<Omit<Order, 'id' | 'created_at' | 'updated_at'>>

export interface OrderItem {
  id: string
  order_id: string
  item_type: 'product' | 'separator'
  section_label: string | null
  sort_order: number
  etm: string
  model_code: string
  description: string
  brand: string
  quantity_approved: number
  quantity_in_stock: number
  quantity_to_order: number
  quantity_received: number
  urrea_status: UrreaStatus
  delivery_time: DeliveryTime
  unit_price: number
  location: string | null // snapshot de store_inventory.location al crear la orden
  created_at: string
}

// location es opcional en el insert (columna nullable; separadores no la llevan).
export type OrderItemInsert =
  Omit<OrderItem, 'id' | 'created_at' | 'location'> & { location?: string | null }
export type OrderItemUpdate = Partial<Omit<OrderItem, 'id' | 'created_at' | 'order_id'>>

// Order with items for detail view
export interface OrderWithItems extends Order {
  order_items: OrderItem[]
}

export interface OrderWithCount extends Order {
  items_count: number
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
  name: string
  customer_name: string
  status: QuotationStatus
  approval_token: string
  total_amount: number
  notes: string | null
  original_file_url: string | null
  approved_at: string | null // fecha/hora de aprobación (cliente finaliza o staff marca approved)
  created_at: string
  updated_at: string
  created_by: string | null
}

export type QuotationInsert = Omit<Quotation, 'id' | 'created_at' | 'updated_at' | 'approval_token' | 'approved_at'>
export type QuotationUpdate = Partial<Omit<Quotation, 'id' | 'created_at' | 'updated_at'>>

export interface QuotationItem {
  id: string
  quotation_id: string
  item_type: 'product' | 'separator'
  section_label: string | null
  etm: string | null
  description: string | null
  description_es: string | null
  // Snapshot del valor RESUELTO al guardar: catálogo URREA ?? curada DYMMSA ?? null.
  // Congelado como el resto de campos del ítem (documento comercial).
  dymmsa_description: string | null
  model_code: string | null
  brand: string | null
  unit_price: number | null
  quantity: number | null
  is_approved: boolean | null
  is_sold: boolean | null // tri-state heredado de etm_products; null = sin definir, false = no lo vendemos
  notes: string | null
  delivery_time: DeliveryTime | null
  sort_order: number
  created_at: string
}

export interface QuotationWithItems extends Quotation {
  quotation_items: QuotationItem[]
}

export interface QuotationWithCount extends Quotation {
  items_count: number
}

// Row in the editable quotation table (local/draft state, not saved to DB yet)
export interface QuotationItemRow {
  _id: string        // React key. For existing items it equals the DB id; for new items it's a local UUID
  _dbId?: string     // real DB id; present only on persisted items (undefined for newly added rows)
  item_type: 'product' | 'separator'
  section_label: string  // label for separator rows (may be empty)
  etm: string        // required, read-only in edit mode
  description: string
  description_es: string
  // Curada DYMMSA (editable solo sin match de catálogo). La oficial del
  // catálogo NO vive aquí: se muestra desde el mapa de lookup y gana jerarquía.
  dymmsa_description: string
  model_code: string
  brand: string
  unit_price: number | null
  quantity: number | null
  delivery_time: DeliveryTime
  _inDb: boolean     // true if ETM was matched in etm_products
  is_approved?: boolean | null  // local approval state; null = pending, true = approved, false = rejected
  is_sold?: boolean | null      // ¿lo vendemos? null = sin definir, true = sí, false = no lo vendemos
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
