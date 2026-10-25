/** The common signer of the confirmations (#155 C4): tool keys and the token Odoo's keys ride on. */

import { describe, test, expect } from 'vitest'
import { argsHash, issuePreviewKey, verifyPreviewKey, PREVIEW_TTL_MS, CONFIRM_UNAVAILABLE_MESSAGE } from '@/lib/mcp/core/confirm/preview-key'
import { canonicalJson, hashOf } from '@/lib/mcp/core/confirm/canonical'
import { openClaims, signClaims } from '@/lib/mcp/core/confirm/token'

const SECRET = Buffer.from('un-secreto-de-prueba-de-al-menos-32-caracteres')
const NOW = Date.UTC(2026, 9, 24, 18, 0)
const scope = { userId: 'u1', tool: 'save_x', args: { b: 2, a: 1 } }
const issue = (extra: object = {}) => issuePreviewKey({ ...scope, fingerprint: { v: 1 }, ...extra }, { now: NOW, secret: SECRET })

describe('token', () => {
  test('firma y abre con el mismo secreto y propósito; cualquier otro lo rechaza', () => {
    const token = signClaims({ a: 1 }, 'p1', SECRET)
    expect(openClaims(token, 'p1', SECRET)).toEqual({ a: 1 })
    expect(openClaims(token, 'p2', SECRET)).toBeNull()
    expect(openClaims(token, 'p1', Buffer.from('otro-secreto-distinto-de-32-caracteres!!'))).toBeNull()
  })

  test('el MAC se compara como texto: un token re-escrito, con relleno o partido no abre', () => {
    const token = signClaims({ a: 1 }, 'p1', SECRET)
    const [payload, mac] = token.split('.')
    for (const bad of [`${payload}.${mac}=`, `${payload}=.${mac}`, `${payload}${mac}`, `${token}.x`, '', '.', 'a.b']) {
      expect(openClaims(bad, 'p1', SECRET), bad).toBeNull()
    }
  })

  test('las llaves van ordenadas: el mismo contenido da el mismo token', () => {
    expect(signClaims({ b: 1, a: { d: 1, c: 2 } }, 'p', SECRET)).toBe(signClaims({ a: { c: 2, d: 1 }, b: 1 }, 'p', SECRET))
    expect(canonicalJson({ b: [{ z: 1, y: 2 }], a: undefined })).toBe('{"b":[{"y":2,"z":1}]}')
  })
})

describe('clave de una herramienta', () => {
  test('vence a los 30 minutos y la verificación devuelve la huella firmada', () => {
    const { clave, vence } = issue()
    expect(new Date(vence).getTime()).toBe(NOW + PREVIEW_TTL_MS)
    const ok = verifyPreviewKey(clave, scope, { now: NOW + PREVIEW_TTL_MS - 1000, secret: SECRET })
    expect(ok.fingerprint).toBe(hashOf({ v: 1 }))
    expect(() => verifyPreviewKey(clave, scope, { now: NOW + PREVIEW_TTL_MS, secret: SECRET })).toThrow(/venció/)
  })

  test('los argumentos cuentan sin su orden, sin undefined y sin la clave', () => {
    expect(argsHash({ a: 1, b: 2 })).toBe(argsHash({ b: 2, a: 1, c: undefined, clave: 'x.y' }))
    expect(argsHash({ a: 1 })).not.toBe(argsHash({ a: 2 }))
  })

  test('otro usuario, otra herramienta u otros datos no pasan; otra herramienta se nombra', () => {
    const { clave } = issue()
    const check = (over: object) => () => verifyPreviewKey(clave, { ...scope, ...over }, { now: NOW, secret: SECRET })
    expect(check({})).not.toThrow()
    expect(check({ userId: 'u2' })).toThrow(/otro usuario/)
    expect(check({ tool: 'save_y' })).toThrow(/otra herramienta \(save_x\)/)
    expect(check({ args: { a: 1 } })).toThrow(/Los datos son distintos/)
  })

  test('sin secreto no se emite ni se verifica nada', () => {
    expect(() => issuePreviewKey({ ...scope, fingerprint: 1 }, { now: NOW, secret: null })).toThrow(CONFIRM_UNAVAILABLE_MESSAGE)
    const { clave } = issue()
    expect(() => verifyPreviewKey(clave, scope, { now: NOW, secret: null })).toThrow(CONFIRM_UNAVAILABLE_MESSAGE)
  })

  test('una clave de Odoo (otro propósito) no abre como clave de herramienta, aunque lleve las mismas claims', () => {
    const { clave } = issue()
    const claims = openClaims(clave, 'tool', SECRET) as object
    const asOdoo = signClaims(claims, 'odoo-quotation', SECRET)
    expect(() => verifyPreviewKey(asOdoo, scope, { now: NOW, secret: SECRET })).toThrow(/no es válida/)
  })
})
