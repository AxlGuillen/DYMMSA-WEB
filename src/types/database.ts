// Database types for DYMMSA
// Will be auto-generated with Supabase CLI in Phase 2

export type UserRole = 'admin' | 'user'

export interface Product {
  etm: string
  description: string
  model: string
  price: number
  brand: string
  createdAt: string
  updatedAt: string
  createdBy: string | null
}

export interface Quote {
  id: string
  userId: string
  filename: string
  totalRequested: number
  totalFound: number
  etmProducts: string[]
  createdAt: string
}

export interface User {
  id: string
  email: string
  role: UserRole
  createdAt: string
  updatedAt: string
}

// Insert types (without auto-generated fields)
export type ProductInsert = Omit<Product, 'createdAt' | 'updatedAt'>
export type QuoteInsert = Omit<Quote, 'id' | 'createdAt'>
