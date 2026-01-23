// Database types for DYMMSA - matches Supabase schema

export interface EtmProduct {
  id: string
  etm: string
  description: string
  descripcion: string
  modelo: string
  precio: number
  marca: string
  created_at: string
  updated_at: string
  created_by: string | null
}

export interface Quote {
  id: string
  user_id: string
  filename: string
  total_requested: number
  total_found: number
  etm_products: string[]
  created_at: string
}

// Insert types (without auto-generated fields)
export type EtmProductInsert = Omit<EtmProduct, 'id' | 'created_at' | 'updated_at'>
export type EtmProductUpdate = Partial<Omit<EtmProduct, 'id' | 'created_at' | 'updated_at'>>
export type QuoteInsert = Omit<Quote, 'id' | 'created_at'>

// Excel row type for import
export interface ExcelProductRow {
  ETM: string
  DESCRIPTION: string
  DESCRIPCION: string
  MODELO: string
  PRECIO: number | string
  MARCA?: string
}
