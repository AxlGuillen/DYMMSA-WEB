/**
 * The one HMAC token of the MCP confirmations (#155 C4, ADR-041 §5): `base64url(canonical claims).mac`.
 * The PURPOSE separates families: a key minted for one can never open another, whatever its claims say.
 */

import { createHmac, timingSafeEqual } from 'node:crypto'
import { canonicalJson } from './canonical'

const KEY_TAG = 'dymmsa-mcp-preview-v1'

const keyFor = (secret: Buffer, purpose: string) => createHmac('sha256', secret).update(`${KEY_TAG}:${purpose}`).digest()

const mac = (secret: Buffer, purpose: string, payload: string) =>
  createHmac('sha256', keyFor(secret, purpose)).update(payload).digest('base64url')

export function signClaims(claims: object, purpose: string, secret: Buffer): string {
  const payload = Buffer.from(canonicalJson(claims), 'utf8').toString('base64url')
  return `${payload}.${mac(secret, purpose, payload)}`
}

/** timingSafeEqual throws on a length mismatch: here that is just "no". */
function sameText(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8')
  const right = Buffer.from(b, 'utf8')
  return left.length === right.length && timingSafeEqual(left, right)
}

const BASE64URL = /^[A-Za-z0-9_-]+$/

/** The claims of a token this secret and purpose signed, else null. The MAC is compared as text: a re-spelled token would mint another marker. */
export function openClaims(token: string, purpose: string, secret: Buffer): unknown {
  const parts = token.split('.')
  if (parts.length !== 2 || !parts.every((part) => BASE64URL.test(part))) return null
  const [payload, signature] = parts
  if (!sameText(signature, mac(secret, purpose, payload))) return null
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  } catch {
    return null
  }
}
