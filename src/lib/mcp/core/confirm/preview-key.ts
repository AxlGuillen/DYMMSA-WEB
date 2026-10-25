/**
 * The confirmation key of the two-phase writes (#155 C4, ADR-041 §5): phase 1 shows the summary and signs it,
 * phase 2 repeats the call with the key. It ties the yes to who asked, which tool, what it said and what it touches.
 */

import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { ToolError } from '../errors'
import { hashOf } from './canonical'
import { openClaims, signClaims } from './token'

export const PREVIEW_TTL_MS = 30 * 60_000
const PREVIEW_TTL_S = PREVIEW_TTL_MS / 1000

/** A weaker secret is as good as none: the keys would be guessable. */
const MIN_SECRET_LENGTH = 32

/** One purpose for every tool key; the tool itself is a claim. Odoo's quotation keys have their own (odoo/preview-token.ts). */
const TOOL_PURPOSE = 'tool'

export const CONFIRM_UNAVAILABLE_MESSAGE =
  'La confirmación en dos pasos todavía no está activada en el servidor (falta la variable MCP_PREVIEW_SECRET), así que no puedo mostrarte el resumen ni escribir. No escribí nada; avisa a quien administra la plataforma.'
/** For a read-only twin that still shows its summary without the secret (preview_time_report): only saving is off. */
export const SAVE_UNAVAILABLE_NOTE =
  'El resumen sí se puede revisar, pero guardar queda apagado hasta que se active la confirmación en dos pasos (falta la variable MCP_PREVIEW_SECRET en el servidor). Avisa a quien administra la plataforma.'
export const KEY_INVALID_MESSAGE = 'La clave no es válida: pide el resumen de nuevo. No escribí nada.'
export const KEY_OTHER_USER_MESSAGE = 'Esa clave es del resumen de otro usuario: pide el tuyo. No escribí nada.'
export const KEY_CHANGED_ARGS_MESSAGE = 'Los datos son distintos a los del resumen: pide el resumen de nuevo. No escribí nada.'
export const KEY_EXPIRED_MESSAGE = 'La clave venció (dura 30 min): pide el resumen de nuevo. No escribí nada.'
export const keyOtherToolMessage = (tool: string) =>
  `Esa clave es de otra herramienta (${tool}): pide el resumen de esta. No escribí nada.`
export const changedSinceSummaryMessage = (subject: string) => `${subject} cambió desde el resumen: vuelve a pedirlo. No escribí nada.`

/** MCP_PREVIEW_SECRET, read per call and never at import; null = confirmations unavailable (fail closed). */
export function previewSecret(): Buffer | null {
  const value = process.env.MCP_PREVIEW_SECRET?.trim() ?? ''
  return value.length >= MIN_SECRET_LENGTH ? Buffer.from(value, 'utf8') : null
}

const claimsSchema = z.strictObject({
  v: z.literal(1),
  u: z.string().min(1).max(100),
  t: z.string().min(1).max(64),
  /** Hash of the call's arguments, `clave` aside. */
  h: z.string().regex(/^[0-9a-f]{64}$/),
  /** Hash of what the write touches, read when the summary was made. */
  f: z.string().regex(/^[0-9a-f]{64}$/),
  n: z.string().regex(/^[A-Za-z0-9_-]{11}$/),
  iat: z.number().int().positive(),
  exp: z.number().int().positive(),
})

export type PreviewKeyClaims = z.infer<typeof claimsSchema>

export interface KeyScope {
  readonly userId: string
  /** The tool the key is for: the one that writes, which for a preview twin is not the one that signs. */
  readonly tool: string
  /** The call's arguments; `clave` and undefined keys do not count. */
  readonly args: unknown
}

export interface KeyDeps {
  now?: number
  nonce?: () => string
  /** Tests only; production reads MCP_PREVIEW_SECRET. */
  secret?: Buffer | null
}

/** The arguments as both phases see them: the key itself is not content. */
export function argsHash(args: unknown): string {
  if (typeof args === 'object' && args !== null && !Array.isArray(args)) {
    return hashOf(Object.fromEntries(Object.entries(args).filter(([key]) => key !== 'clave')))
  }
  return hashOf(args)
}

const secretOrThrow = (deps: KeyDeps): Buffer => {
  const secret = deps.secret === undefined ? previewSecret() : deps.secret
  if (!secret) throw new ToolError(CONFIRM_UNAVAILABLE_MESSAGE)
  return secret
}

export interface IssuedKey {
  clave: string
  /** ISO instant the key stops serving a write. */
  vence: string
}

/** `fingerprint` is whatever the write depends on (versions, stock read, the set of drafts…): a change voids the key. */
export function issuePreviewKey(scope: KeyScope & { fingerprint: unknown }, deps: KeyDeps = {}): IssuedKey {
  const secret = secretOrThrow(deps)
  const iat = Math.floor((deps.now ?? Date.now()) / 1000)
  const claims: PreviewKeyClaims = {
    v: 1,
    u: scope.userId,
    t: scope.tool,
    h: argsHash(scope.args),
    f: hashOf(scope.fingerprint),
    n: (deps.nonce ?? (() => randomBytes(8).toString('base64url')))(),
    iat,
    exp: iat + PREVIEW_TTL_S,
  }
  return { clave: signClaims(claims, TOOL_PURPOSE, secret), vence: new Date(claims.exp * 1000).toISOString() }
}

/** Signature, user, tool, arguments and expiry; it returns the fingerprint hash the summary was made on. */
export function verifyPreviewKey(clave: string, scope: KeyScope, deps: KeyDeps = {}): { fingerprint: string } {
  const secret = secretOrThrow(deps)
  const parsed = claimsSchema.safeParse(openClaims(clave.trim(), TOOL_PURPOSE, secret))
  if (!parsed.success) throw new ToolError(KEY_INVALID_MESSAGE)
  const claims = parsed.data
  if (claims.u !== scope.userId) throw new ToolError(KEY_OTHER_USER_MESSAGE)
  if (claims.t !== scope.tool) throw new ToolError(keyOtherToolMessage(claims.t))
  if (claims.h !== argsHash(scope.args)) throw new ToolError(KEY_CHANGED_ARGS_MESSAGE)
  if ((deps.now ?? Date.now()) >= claims.exp * 1000) throw new ToolError(KEY_EXPIRED_MESSAGE)
  return { fingerprint: claims.f }
}

/** For a tool that gets its key from a preview twin (save_time_entries): the fingerprint it computes now must be the one signed. */
export function verifyPreviewKeyFor(clave: string, scope: KeyScope & { fingerprint: unknown; subject: string }, deps: KeyDeps = {}): void {
  const signed = verifyPreviewKey(clave, scope, deps)
  if (signed.fingerprint !== hashOf(scope.fingerprint)) throw new ToolError(changedSinceSummaryMessage(scope.subject))
}

/** The `clave` every two-phase tool takes and every preview twin returns. */
export const claveField = z.string().optional().describe('Clave del resumen (fase 1); sin ella solo se muestra el resumen')
