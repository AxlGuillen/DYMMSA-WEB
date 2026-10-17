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

/** The write key is the on/off switch: no fallback to ODOO_API_KEY (#144, ADR-040). */
export function isOdooWriteConfigured(): boolean {
  try {
    odooWriteEnv()
    return true
  } catch {
    return false
  }
}

const hasControlChar = (value: string) =>
  [...value].some((char) => char.charCodeAt(0) < 0x20 || char.charCodeAt(0) === 0x7f)

const WRITE_ORIGIN_MESSAGE =
  'ODOO_URL debe ser solo el origen con https (ej. https://<empresa>.odoo.com): la escritura en Odoo queda deshabilitada.'

/** https and origin only: the write key must never travel in clear nor to another path (#144). */
function writeOrigin(url: string): string {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new OdooError(WRITE_ORIGIN_MESSAGE)
  }
  const originOnly = parsed.pathname === '/' && !parsed.search && !parsed.hash && !parsed.username && !parsed.password
  if (parsed.protocol !== 'https:' || !originOnly) throw new OdooError(WRITE_ORIGIN_MESSAGE)
  return parsed.origin
}

/** Read on every call, never at import: server.ts is imported without the variable (#144). */
export function odooWriteEnv(): OdooEnv {
  const url = process.env.ODOO_URL?.trim().replace(/\/+$/, '')
  const apiKey = process.env.ODOO_WRITE_API_KEY?.trim()
  if (!apiKey) {
    throw new OdooError('La escritura en Odoo está deshabilitada en este servidor (falta ODOO_WRITE_API_KEY).')
  }
  if (!url) {
    throw new OdooError('La escritura en Odoo está deshabilitada en este servidor (falta ODOO_URL).')
  }
  // The message never echoes the key; a header TypeError from undici would.
  if (hasControlChar(apiKey)) {
    throw new OdooError('ODOO_WRITE_API_KEY trae caracteres no válidos (¿un salto de línea al pegarla?). No se escribió nada.')
  }
  return { url: writeOrigin(url), apiKey, db: process.env.ODOO_DB || null }
}
