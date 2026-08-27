import { OdooError } from './client'

/** Env de Odoo — NO valida al importar: el bloque es opcional (ADR-025). */
export interface OdooEnv {
  /** Solo el origen, sin diagonal final. */
  url: string
  apiKey: string
  /** Opcional: solo aplica si un dominio sirve varias bases (Odoo Online: una). */
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
