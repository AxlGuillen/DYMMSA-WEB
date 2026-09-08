import { OdooError } from './client'

/** Not validated at import: the Odoo block is optional (ADR-025). */
export interface OdooEnv {
  /** Origin only, no trailing slash. */
  url: string
  apiKey: string
  /** Only relevant when a domain serves several databases (Odoo Online has one). */
  db: string | null
}

export function isOdooConfigured(): boolean {
  return Boolean(process.env.ODOO_URL && process.env.ODOO_API_KEY)
}

export function odooEnv(): OdooEnv {
  const url = process.env.ODOO_URL?.replace(/\/+$/, '')
  const apiKey = process.env.ODOO_API_KEY
  if (!url || !apiKey) {
    throw new OdooError(
      'El bloque de Odoo no está configurado: faltan ODOO_URL y/o ODOO_API_KEY en el entorno del servidor.',
    )
  }
  return { url, apiKey, db: process.env.ODOO_DB || null }
}
