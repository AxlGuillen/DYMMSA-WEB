/**
 * Preview keys (#144, ADR-040): an HMAC token ties every save to the preview the admin saw —
 * same admin, same canonical content, same intent, within 30 min. The products one rides in _meta only.
 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'

import { OdooError } from './client'
import { odooWriteEnv } from './env'
import { assertAdminProof, type AdminProof } from './write-guard'
import type { MarkerKeys } from './writer'

export const PREVIEW_TTL_MS = 30 * 60_000
const PREVIEW_TTL_S = PREVIEW_TTL_MS / 1000

/** Where the view finds the products authorization; it never travels in the text the model reads. */
export const PRODUCTS_AUTHORIZATION_META = 'dymmsa/autorizacion'

export type QuotationKeyKind = 'crear' | 'editar' | 'confirmar'

const KIND_LABEL: Readonly<Record<QuotationKeyKind, string>> = Object.freeze({
  crear: 'crear una cotización',
  editar: 'editar la cotización',
  confirmar: 'confirmar la venta',
})

export const PREVIEW_KEY_MISSING_MESSAGE =
  'Falta la clave de la vista previa: pide primero odoo_preview_quotation y repite con su clave. No escribí nada.'
export const PREVIEW_KEY_INVALID_MESSAGE =
  'La clave de la vista previa no es válida: pide la vista previa de nuevo. No escribí nada.'
export const PREVIEW_KEY_OTHER_ADMIN_MESSAGE =
  'Esa clave es de la vista previa de otro administrador: pide la tuya. No escribí nada.'
export const PREVIEW_CHANGED_MESSAGE = 'Algo cambió desde la vista previa: vuelve a pedirla. No escribí nada.'
export const PREVIEW_EXPIRED_MESSAGE = 'La vista previa venció (dura 30 min): pídela de nuevo. No escribí nada.'
export const PREVIEW_GRANT_MISSING_MESSAGE =
  'Sin una vista previa vigente no se escribe en Odoo: pide odoo_preview_quotation de nuevo. No escribí nada.'

export const PRODUCTS_UNAUTHORIZED_MESSAGE =
  'El alta de productos solo se hace con el botón de la vista previa en Claude (web, escritorio o móvil). No se creó nada: dalos de alta en Odoo y vuelve a pedir la vista previa.'
export const PRODUCTS_OTHER_ADMIN_MESSAGE =
  'Esa autorización es de la vista previa de otro administrador: pide la tuya. No se creó nada.'
export const PRODUCTS_CHANGED_MESSAGE =
  'La autorización no corresponde a estos productos: vuelve a pedir la vista previa. No se creó nada.'
export const PRODUCTS_EXPIRED_MESSAGE = 'La vista previa venció: pídele a Claude que la repita. No se creó nada.'

const userId = z.string().min(1).max(100)
const epochSeconds = z.number().int().positive()
const sha256Hex = z.string().regex(/^[0-9a-f]{64}$/)

const quotationClaims = z
  .strictObject({
    v: z.literal(1),
    k: z.enum(['crear', 'editar', 'confirmar']),
    u: userId,
    /** 8 random bytes: two identical previews must never share a key nor its marker. */
    n: z.string().regex(/^[A-Za-z0-9_-]{11}$/),
    iat: epochSeconds,
    exp: epochSeconds,
    h: sha256Hex,
    p: z.number().int().positive(),
    s: z.number().int().positive().nullable(),
    w: z.string().min(1).max(40).nullable(),
  })
  // Creating has no sale yet; editing and confirming pin the one the preview read.
  .refine((c) => (c.k === 'crear') === (c.s === null) && (c.s === null) === (c.w === null))

/** p/s/w are what the preview resolved: the save compares them against its own reread of Odoo. */
export type QuotationKeyClaims = z.infer<typeof quotationClaims>

const satKey = z.string().regex(/^\d{8}$/)
// The chat's key plus three suggestions; 40 products a side, as the alta and the assign take.
const offeredKeys = z.array(satKey).max(4)
const MAX_SIGNED_PRODUCTS = 40

const productsClaims = z.strictObject({
  v: z.literal(2),
  k: z.literal('products'),
  u: userId,
  iat: epochSeconds,
  exp: epochSeconds,
  /** productos_para_alta without their keys: the admin picks one in the view (#154). */
  h: sha256Hex,
  /** Keys offered per new product, aligned with h's list. */
  ks: z.array(offeredKeys).max(MAX_SIGNED_PRODUCTS),
  /** Existing products the view may give a key to, with the keys offered for each. */
  a: z.array(z.tuple([z.number().int().positive(), offeredKeys])).max(MAX_SIGNED_PRODUCTS),
})

export type ProductsKeyClaims = z.infer<typeof productsClaims>

/** What the preview and the save (or the confirm) receive after zod; any other field is hashed too. */
export interface QuotationKeyInput {
  readonly cliente?: string
  readonly folio?: string
  readonly lineas?: readonly Readonly<Record<string, unknown>>[]
  readonly vigencia?: string
  readonly clave?: string
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Keys sorted at every depth; undefined dropped as JSON does. */
export function canonicalJson(value: unknown): string {
  const sorted = (_key: string, v: unknown) =>
    isRecord(v) ? Object.fromEntries(Object.keys(v).sort().map((key) => [key, v[key]])) : v
  return JSON.stringify(value, sorted) ?? 'null'
}

// The save and the confirm repeat the preview with its `clave`, which is not content.
const NOT_CONTENT: ReadonlySet<string> = new Set(['clave'])

/** Line values that only restate the default: written or omitted, the preview is the same. */
const LINE_DEFAULTS: ReadonlyMap<string, unknown> = new Map([['descuento', 0]])

function trimmed(value: unknown): unknown {
  if (typeof value === 'string') return value.trim()
  if (Array.isArray(value)) return value.map(trimmed)
  if (!isRecord(value)) return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .map(([key, v]) => [key, trimmed(v)]),
  )
}

function canonicalLine(line: unknown): unknown {
  if (!isRecord(line)) return trimmed(line)
  return Object.fromEntries(
    Object.entries(line)
      .filter(([key, v]) => v !== undefined && !(LINE_DEFAULTS.has(key) && LINE_DEFAULTS.get(key) === v))
      .map(([key, v]) => [key, trimmed(v)]),
  )
}

/** Runs after zod so a review key ({folio}) also fits odoo_confirm_quotation ({folio, clave}); line order counts. */
export function canonicalQuotationInput(input: QuotationKeyInput): Record<string, unknown> {
  const canonical: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || NOT_CONTENT.has(key)) continue
    if (key === 'folio' && typeof value === 'string') canonical[key] = value.trim().toUpperCase()
    else if (key === 'lineas' && Array.isArray(value)) canonical[key] = value.map(canonicalLine)
    else canonical[key] = trimmed(value)
  }
  return canonical
}

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex')

export function quotationContentHash(input: QuotationKeyInput): string {
  return sha256(canonicalJson(canonicalQuotationInput(input)))
}

/** The key the admin chooses in the view is not content: choosing another offered one keeps the hash. */
const CHOICE_FIELDS: ReadonlySet<string> = new Set(['clave_sat', 'clave_sat_tecleada'])

const withoutChoice = (product: unknown) =>
  isRecord(product) ? Object.fromEntries(Object.entries(product).filter(([key]) => !CHOICE_FIELDS.has(key))) : product

const productsContentHash = (products: readonly unknown[]) => sha256(canonicalJson(products.map(withoutChoice)))

/** Derived from the write key: no key, no tokens; rotating it voids every pending preview. */
function previewSecret(): Buffer {
  return createHmac('sha256', odooWriteEnv().apiKey).update('dymmsa-mcp-preview-v1').digest()
}

const mac = (secret: Buffer, payload: string) => createHmac('sha256', secret).update(payload).digest('base64url')

function sign(claims: QuotationKeyClaims | ProductsKeyClaims): string {
  const payload = Buffer.from(canonicalJson(claims), 'utf8').toString('base64url')
  return `${payload}.${mac(previewSecret(), payload)}`
}

/** timingSafeEqual throws on a length mismatch: here that is just "no". */
function sameText(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8')
  const right = Buffer.from(b, 'utf8')
  return left.length === right.length && timingSafeEqual(left, right)
}

const BASE64URL = /^[A-Za-z0-9_-]+$/

// The MAC is compared as text: a re-spelled token (padding, other base64) would mint another marker.
function openToken(token: string): unknown {
  const parts = token.split('.')
  if (parts.length !== 2 || !parts.every((part) => BASE64URL.test(part))) return null
  const [payload, signature] = parts
  if (!sameText(signature, mac(previewSecret(), payload))) return null
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  } catch {
    return null
  }
}

/** k10 is the idempotency marker: a retry with the same key finds the same order (ADR-040). */
function markersOf(clave: string, h: string): MarkerKeys {
  return { k10: sha256(clave).slice(0, 10), h10: h.slice(0, 10) }
}

const randomNonce = () => randomBytes(8).toString('base64url')

const expiry = (exp: number) => new Date(exp * 1000).toISOString()

interface TokenClock {
  now?: number
}

export interface QuotationKeyTarget {
  kind: QuotationKeyKind
  input: QuotationKeyInput
  /** The res.partner the preview resolved. */
  partnerId: number
  /** The sale and its write_date as previewed; null when creating. */
  saleId: number | null
  writeDate: string | null
}

export interface IssuedQuotationKey {
  clave: string
  /** ISO instant the key stops serving a write. */
  vence: string
  markers: MarkerKeys
}

export function issueQuotationKey(
  proof: AdminProof,
  target: QuotationKeyTarget,
  deps: TokenClock & { nonce?: () => string } = {},
): IssuedQuotationKey {
  const now = deps.now ?? Date.now()
  assertAdminProof(proof, now)
  const iat = Math.floor(now / 1000)
  const parsed = quotationClaims.safeParse({
    v: 1,
    k: target.kind,
    u: proof.userId,
    n: (deps.nonce ?? randomNonce)(),
    iat,
    exp: iat + PREVIEW_TTL_S,
    h: quotationContentHash(target.input),
    p: target.partnerId,
    s: target.saleId,
    w: target.writeDate,
  })
  if (!parsed.success) throw new OdooError('No pude emitir la clave de la vista previa: faltan datos de la cotización.')
  const clave = sign(parsed.data)
  return { clave, vence: expiry(parsed.data.exp), markers: markersOf(clave, parsed.data.h) }
}

export interface VerifiedQuotationKey {
  readonly claims: Readonly<QuotationKeyClaims>
  /** Usable for the "ya estaba" reads even when expired; only grantPreviewWrite() leads to a write. */
  readonly markers: MarkerKeys
  readonly expired: boolean
}

declare const previewGrantBrand: unique symbol

/** A live preview key turned into permission to write: createQuotation/updateQuotation/confirmSale demand it. */
export interface PreviewGrant {
  readonly kind: QuotationKeyKind
  readonly userId: string
  readonly partnerId: number
  readonly saleId: number | null
  readonly markers: MarkerKeys
  /** Epoch ms; the writer checks it again when the write leaves. */
  readonly expiresAt: number
  readonly [previewGrantBrand]: true
}

// Identity, not shape (like AdminProof): a copied verification or grant never writes.
const verifiedKeys = new WeakSet<object>()
const grants = new WeakSet<object>()

const kindMismatch = (got: QuotationKeyKind, want: QuotationKeyKind) =>
  new OdooError(
    `Esa clave es de la vista previa para ${KIND_LABEL[got]}, no para ${KIND_LABEL[want]}: pide la vista previa de nuevo. No escribí nada.`,
  )

/** Signature, admin, intent and content; no Odoo call happens before this passes. */
export function verifyQuotationKey(
  proof: AdminProof,
  clave: unknown,
  expected: { kind: QuotationKeyKind; input: QuotationKeyInput },
  deps: TokenClock = {},
): VerifiedQuotationKey {
  const now = deps.now ?? Date.now()
  assertAdminProof(proof, now)
  const token = typeof clave === 'string' ? clave.trim() : ''
  if (!token) throw new OdooError(PREVIEW_KEY_MISSING_MESSAGE)
  const parsed = quotationClaims.safeParse(openToken(token))
  if (!parsed.success) throw new OdooError(PREVIEW_KEY_INVALID_MESSAGE)
  const claims = Object.freeze(parsed.data)
  if (claims.u !== proof.userId) throw new OdooError(PREVIEW_KEY_OTHER_ADMIN_MESSAGE)
  if (claims.k !== expected.kind) throw kindMismatch(claims.k, expected.kind)
  if (claims.h !== quotationContentHash(expected.input)) throw new OdooError(PREVIEW_CHANGED_MESSAGE)
  const verified: VerifiedQuotationKey = Object.freeze({
    claims,
    markers: Object.freeze(markersOf(token, claims.h)),
    expired: now >= claims.exp * 1000,
  })
  verifiedKeys.add(verified)
  return verified
}

/** The only way from a key to a write: an expired one never gets here, whatever the tool forgets (ADR-040). */
export function grantPreviewWrite(verified: VerifiedQuotationKey, deps: TokenClock = {}): PreviewGrant {
  if (!verifiedKeys.has(verified)) throw new OdooError(PREVIEW_GRANT_MISSING_MESSAGE)
  const expiresAt = verified.claims.exp * 1000
  if ((deps.now ?? Date.now()) >= expiresAt) throw new OdooError(PREVIEW_EXPIRED_MESSAGE)
  const { k, u, p, s } = verified.claims
  const grant = Object.freeze({ kind: k, userId: u, partnerId: p, saleId: s, markers: verified.markers, expiresAt })
  grants.add(grant)
  return grant as PreviewGrant
}

export interface PreviewGrantTarget {
  kind: QuotationKeyKind
  userId: string
  /** null when creating; otherwise the sale the write targets. */
  saleId: number | null
  /** Only when creating: the partner the order is created for. */
  partnerId?: number
}

/** The writer's check: minted here, same admin, operation and sale, still within its 30 min. */
export function assertPreviewGrant(grant: PreviewGrant, target: PreviewGrantTarget, now: number = Date.now()): void {
  if (typeof grant !== 'object' || grant === null || !grants.has(grant)) {
    throw new OdooError(PREVIEW_GRANT_MISSING_MESSAGE)
  }
  if (grant.userId !== target.userId) throw new OdooError(PREVIEW_KEY_OTHER_ADMIN_MESSAGE)
  if (grant.kind !== target.kind) throw kindMismatch(grant.kind, target.kind)
  const otherPartner = target.partnerId !== undefined && grant.partnerId !== target.partnerId
  if (grant.saleId !== target.saleId || otherPartner) throw new OdooError(PREVIEW_CHANGED_MESSAGE)
  if (now >= grant.expiresAt) throw new OdooError(PREVIEW_EXPIRED_MESSAGE)
}

export interface IssuedAuthorization {
  autorizacion: string
  vence: string
}

/** What the products authorization covers (#154): the alta list and the keys the preview offered. */
export interface ProductsAuthorizationScope {
  /** productos_para_alta exactly as the view sends them; each one's own clave_sat is always offered. */
  readonly alta: readonly unknown[]
  /** Suggested keys per alta product, aligned. */
  readonly altaKeys?: readonly (readonly string[])[]
  /** Existing products without a key, each with the keys offered for it. */
  readonly asignar?: readonly { readonly productId: number; readonly keys: readonly string[] }[]
}

const ownKey = (product: unknown): string[] =>
  isRecord(product) && typeof product.clave_sat === 'string' ? [product.clave_sat] : []

/**
 * Signs productos_para_alta (keys aside), the offered keys per product and which existing products may be keyed.
 * The offered keys are not a lock on their own: a key marked as typed bypasses them and is checked against the catalog.
 */
export function issueProductsAuthorization(
  proof: AdminProof,
  scope: ProductsAuthorizationScope,
  deps: TokenClock = {},
): IssuedAuthorization {
  const now = deps.now ?? Date.now()
  assertAdminProof(proof, now)
  const iat = Math.floor(now / 1000)
  const parsed = productsClaims.safeParse({
    v: 2,
    k: 'products',
    u: proof.userId,
    iat,
    exp: iat + PREVIEW_TTL_S,
    h: productsContentHash(scope.alta),
    ks: scope.alta.map((product, i) => [...new Set([...ownKey(product), ...(scope.altaKeys?.[i] ?? [])])]),
    a: (scope.asignar ?? []).map((p) => [p.productId, [...new Set(p.keys)]]),
  })
  if (!parsed.success) throw new OdooError('No pude emitir la autorización de la vista previa: faltan datos de los productos.')
  return { autorizacion: sign(parsed.data), vence: expiry(parsed.data.exp) }
}

/**
 * Signature, admin, expiry and, for an alta, the list itself (keys aside). Which key each product may
 * take is the caller's check against ks / a: odoo_save_product knows whether the admin typed it.
 */
export function verifyProductsAuthorization(
  proof: AdminProof,
  autorizacion: unknown,
  products: readonly unknown[] | null,
  deps: TokenClock = {},
): ProductsKeyClaims {
  const now = deps.now ?? Date.now()
  assertAdminProof(proof, now)
  const token = typeof autorizacion === 'string' ? autorizacion.trim() : ''
  const parsed = token ? productsClaims.safeParse(openToken(token)) : null
  if (!parsed?.success) throw new OdooError(PRODUCTS_UNAUTHORIZED_MESSAGE)
  const claims = parsed.data
  if (claims.u !== proof.userId) throw new OdooError(PRODUCTS_OTHER_ADMIN_MESSAGE)
  if (products !== null && claims.h !== productsContentHash(products)) throw new OdooError(PRODUCTS_CHANGED_MESSAGE)
  if (now >= claims.exp * 1000) throw new OdooError(PRODUCTS_EXPIRED_MESSAGE)
  return claims
}
