// Database types for DYMMSA - matches Supabase schema

export interface EtmProduct {
  id: string
  etm: string
  description: string
  description_es: string
  // Curated; stays empty when urrea_catalog matches — the official one wins (ADR-013).
  dymmsa_description: string | null
  model_code: string
  price: number
  brand: string
  is_sold: boolean | null // tri-state: null = undefined, true = we sell it, false = we don't
  // Nominal cut measurements in mm (#59): they ONLY pre-fill the list; the
  // truth of each plan lives in cut_plan_pieces.
  cut_kind: CutMaterialType | null
  cut_diameter_mm: number | null
  cut_thickness_mm: number | null
  cut_width_mm: number | null
  cut_length_mm: number | null
  created_at: string
  updated_at: string
  created_by: string | null
}

// Insert types: nullable columns stay optional, so partial inserts are valid.
export type EtmProductInsert =
  Omit<
    EtmProduct,
    | 'id' | 'created_at' | 'updated_at' | 'is_sold' | 'dymmsa_description'
    | 'cut_kind' | 'cut_diameter_mm' | 'cut_thickness_mm' | 'cut_width_mm' | 'cut_length_mm'
  > &
  {
    is_sold?: boolean | null
    dymmsa_description?: string | null
    cut_kind?: CutMaterialType | null
    cut_diameter_mm?: number | null
    cut_thickness_mm?: number | null
    cut_width_mm?: number | null
    cut_length_mm?: number | null
  }
export type EtmProductUpdate = Partial<Omit<EtmProduct, 'id' | 'created_at' | 'updated_at'>>

// Cut module (#59): units are ALWAYS mm.

export type CutMaterialType = 'tube' | 'plate'

/** DB CHECK on shape: tube → diameter, plate → thickness+width. */
export interface CutPlanPiece {
  id: string
  order_id: string
  material_type: CutMaterialType
  diameter_mm: number | null
  thickness_mm: number | null
  width_mm: number | null
  length_mm: number
  quantity: number
  /** What the customer asked for; records the match to the size actually used. */
  requested_label: string | null
  source_item_id: string | null
  sort_order: number
  created_at: string
  updated_at: string
}

export type CutPlanPieceInsert = Omit<CutPlanPiece, 'id' | 'created_at' | 'updated_at'>

/** Supplier stock size ("6 m bars"); the catalog builds itself from what is captured. */
export interface MaterialPresentation {
  id: string
  material_type: CutMaterialType
  diameter_mm: number | null
  thickness_mm: number | null
  width_mm: number | null
  /** Commercial length of the bar / sheet. */
  length_mm: number
  last_used_at: string
  created_at: string
}

// Excel row type for import
export interface ExcelProductRow {
  ETM: string
  DESCRIPTION: string
  DESCRIPTION_ES: string
  MODEL_CODE: string
  PRICE: number | string
  BRAND?: string
}

export interface StoreInventory {
  id: string
  model_code: string
  quantity: number
  location: string | null // physical spot (drawer); kept even when quantity=0
  updated_at: string
}

// location is optional on insert (nullable column).
export type StoreInventoryInsert =
  Omit<StoreInventory, 'id' | 'updated_at' | 'location'> & { location?: string | null }
export type StoreInventoryUpdate = Partial<Omit<StoreInventory, 'id' | 'updated_at'>>

// URREA catalog: isolated table, cross-referenced by value (no FKs).
export interface UrreaCatalogItem {
  id: string
  code: string
  brand: string // line, normalized trim+UPPER. Identity = (code, brand)
  description: string | null
  std: number
  created_at: string
  updated_at: string
}

// brand is optional on insert: the column has DEFAULT 'URREA'.
export type UrreaCatalogInsert =
  Omit<UrreaCatalogItem, 'id' | 'created_at' | 'updated_at' | 'brand'> & { brand?: string }
export type UrreaCatalogUpdate = Partial<Omit<UrreaCatalogItem, 'id' | 'created_at' | 'updated_at'>>

export interface Supplier {
  id: string
  name: string
  phone: string | null
  whatsapp: string | null
  email: string | null
  address: string | null
  notes: string | null
  /** Credit terms in days; null = cash (#84). */
  payment_terms_days: number | null
  created_at: string
  updated_at: string
}

export type SupplierInsert = Omit<Supplier, 'id' | 'created_at' | 'updated_at'>
export type SupplierUpdate = Partial<SupplierInsert>

/** Global brand catalog; name normalized trim+upper. */
export interface Brand {
  id: string
  name: string
  created_at: string
}

/** Brand with the count of suppliers using it (GET /api/brands). */
export interface BrandWithCount extends Brand {
  suppliersCount: number
}

/** Supplier with its brands flattened (GET /api/suppliers). */
export interface SupplierWithBrands extends Supplier {
  brands: Brand[]
}

export type PayableStatus = 'pending' | 'paid' | 'cancelled'

/** Own expense record; official invoicing lives in Odoo (#84). */
export interface Payable {
  id: string
  supplier_id: string
  concept: string
  amount: number
  invoice_date: string
  /** Pre-filled with invoice_date + the supplier's payment_terms_days; editable. */
  due_date: string
  status: PayableStatus
  /** REAL payment date; may differ from the due date. */
  paid_at: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

/** Payable with its supplier embedded (GET /api/payables). */
export interface PayableWithSupplier extends Payable {
  supplier: Pick<Supplier, 'id' | 'name' | 'payment_terms_days'>
}

export type PayableInsert = Omit<Payable, 'id' | 'created_at' | 'updated_at'>
export type PayableUpdate = Partial<PayableInsert>

export type ProfileRole = 'admin' | 'member'

/** 1:1 with auth.users; the first per-person permission in the app (ADR-026, #93). */
export interface Profile {
  id: string
  display_name: string
  role: ProfileRole
  /** NGTeco employee id; null = does not clock in. */
  clock_employee_id: number | null
  created_at: string
  updated_at: string
}

export type ProfileUpdate = Partial<Pick<Profile, 'display_name' | 'role' | 'clock_employee_id'>>

export type TimeEntrySource = 'import' | 'manual'

/** One clock-in/out pair; daily and weekly totals are computed, never stored (#93). */
export interface TimeEntry {
  id: string
  user_id: string
  work_date: string
  /** What the clock said. Immutable: the re-import idempotency key. */
  source_clock_in: string
  clock_in: string
  clock_out: string | null
  note: string | null
  source: TimeEntrySource
  edited_by: string | null
  edited_at: string | null
  /** Pre-edit snapshot, written once and never overwritten. */
  original: { clock_in: string; clock_out: string | null; note: string | null } | null
  created_at: string
  updated_at: string
}

export type TimeEntryUpdate = Partial<Pick<TimeEntry, 'clock_in' | 'clock_out' | 'note'>>

/** One upload of the weekly clock report. */
export interface TimeImport {
  id: string
  period_start: string
  period_end: string
  file_name: string | null
  inserted: number
  updated: number
  skipped_edited: number
  imported_by: string | null
  created_at: string
}

/** Response of POST /api/time-entries/import. */
export interface TimeImportResult {
  period: { start: string; end: string }
  inserted: number
  updated: number
  skipped_edited: number
  /** Clock employees with no profile mapped; imported rows exclude them. */
  unmapped: { clockId: number; name: string }[]
  warnings: string[]
}

// Excel row type for inventory import
export interface ExcelInventoryRow {
  MODEL_CODE: string
  QUANTITY: number | string
}

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
  /** Section color override (#73); null = automatic by index. */
  separator_color: string | null
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
  location: string | null // snapshot of store_inventory.location when the order was created
  created_at: string
}

// location is optional on insert; separators never carry it.
export type OrderItemInsert =
  Omit<OrderItem, 'id' | 'created_at' | 'location' | 'separator_color'> &
  { location?: string | null; separator_color?: string | null }
export type OrderItemUpdate = Partial<Omit<OrderItem, 'id' | 'created_at' | 'order_id'>>

// Wholesale/retail decision per order and GROUP (ADR-018); never global product truth.
export interface OrderPurchaseDecision {
  id: string
  order_id: string
  model_code: string // normalized trim+upper (catalogKey)
  brand: string // normalized trim+upper
  std_snapshot: number // catalog STD when decided (stale if it changes)
  needed_qty: number // consolidated N when decided (stale if it changes)
  packages_wholesale: number
  qty_retail: number
  decided_at: string
}

export type OrderPurchaseDecisionInsert =
  Omit<OrderPurchaseDecision, 'id' | 'decided_at'> & { decided_at?: string }

// Key-value config: no seeds, a missing row means the default in code.
export interface AppSetting {
  key: string
  value: unknown // jsonb
  updated_at: string
}

export interface OrderWithItems extends Order {
  order_items: OrderItem[]
}

export interface OrderWithCount extends Order {
  items_count: number
}

// Approved product from Excel (green rows)
export interface ApprovedProduct {
  etm: string
  description: string
  description_es: string
  model_code: string
  quantity: number
  price: number
  brand: string
}

export interface CreateOrderInput {
  customer_name: string
  products: ApprovedProduct[]
}

export interface ConfirmReceptionInput {
  items: {
    id: string
    quantity_received: number
    urrea_status: UrreaStatus
  }[]
}

// Warnings ready to toast (ADR-019): inventory clamped at 0, etc.
export interface ConfirmReceptionResult {
  success: boolean
  inventory_updated: number
  warnings: string[]
}

export interface AutoLearnResult {
  added: number
  skipped: number
  existing: number
}

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
  approved_at: string | null // sealed on approval; preserved in later phases, never cleared
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
  /** Section color override (#73); null = automatic by index. */
  separator_color: string | null
  etm: string | null
  description: string | null
  description_es: string | null
  // Snapshot of the RESOLVED value at save time, frozen like the rest (ADR-013).
  dymmsa_description: string | null
  model_code: string | null
  brand: string | null
  unit_price: number | null
  quantity: number | null
  is_approved: boolean | null
  is_sold: boolean | null // tri-state inherited from etm_products; false = we don't sell it
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

// Editable quotation row: local draft state, not persisted yet.
export interface QuotationItemRow {
  _id: string        // React key: the DB id for existing items, a local UUID for new ones
  _dbId?: string     // real DB id; present only on persisted items (undefined for newly added rows)
  item_type: 'product' | 'separator'
  section_label: string  // label for separator rows (may be empty)
  /** Section color override (#73); null/undefined = automatic. */
  separator_color?: string | null
  etm: string        // required, read-only in edit mode
  description: string
  description_es: string
  // Curated only; the official one comes from the lookup map and wins (ADR-013).
  dymmsa_description: string
  model_code: string
  brand: string
  unit_price: number | null
  quantity: number | null
  delivery_time: DeliveryTime
  _inDb: boolean     // true if ETM was matched in etm_products
  is_approved?: boolean | null  // local state; null = pending, true = approved, false = rejected
  is_sold?: boolean | null      // null = undefined, true = we sell it, false = we don't
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
