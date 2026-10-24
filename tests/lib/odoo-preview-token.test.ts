/** Preview keys (#144, ADR-040): HMAC over canonical content, admin and intent; nothing reaches Odoo. */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { createHash } from 'node:crypto'
import { OdooError } from '@/lib/odoo/client'
import {
  assertPreviewGrant,
  canonicalJson,
  canonicalQuotationInput,
  grantPreviewWrite,
  issueProductsAuthorization,
  issueQuotationKey,
  PREVIEW_CHANGED_MESSAGE,
  PREVIEW_EXPIRED_MESSAGE,
  PREVIEW_GRANT_MISSING_MESSAGE,
  PREVIEW_KEY_INVALID_MESSAGE,
  PREVIEW_KEY_MISSING_MESSAGE,
  PREVIEW_KEY_OTHER_ADMIN_MESSAGE,
  PREVIEW_TTL_MS,
  PRODUCTS_CHANGED_MESSAGE,
  PRODUCTS_EXPIRED_MESSAGE,
  PRODUCTS_OTHER_ADMIN_MESSAGE,
  PRODUCTS_UNAUTHORIZED_MESSAGE,
  quotationContentHash,
  verifyProductsAuthorization,
  verifyQuotationKey,
  type QuotationKeyInput,
  type QuotationKeyTarget,
} from '@/lib/odoo/preview-token'
import { ADMIN_ONLY_MESSAGE } from '@/lib/odoo/write-guard'
import { testAdminProof } from '../helpers/fake-odoo'

const WRITE_KEY = 'write-key-0123456789abcdef'
const NOW = Date.UTC(2026, 9, 17, 22, 0)
const ADMIN = 'admin-1'

const CREATE_INPUT: QuotationKeyInput = {
  cliente: '#1',
  lineas: [
    { nota: 'PRUEBA #144 — no procesar' },
    { producto_id: 30888, cantidad: 1, precio: 1 },
    { codigo: 'ZZTEST144', descripcion: 'Producto de prueba del asistente', marca: 'PRUEBA', cantidad: 1, precio: 1 },
  ],
}

const CREATE_TARGET: QuotationKeyTarget = {
  kind: 'crear',
  input: CREATE_INPUT,
  partnerId: 1,
  saleId: null,
  writeDate: null,
}

const REVIEW_TARGET: QuotationKeyTarget = {
  kind: 'confirmar',
  input: { folio: 'S00912' },
  partnerId: 1,
  saleId: 912,
  writeDate: '2026-10-17 22:47:43',
}

const PRODUCTS = [{ codigo: 'ZZTEST144', descripcion: 'Producto de prueba del asistente', marca: 'PRUEBA', precio: 1 }]

/** A fresh proof at the instant of each call: the guard's own TTL is 90 s. */
const proofAt = (now: number, userId = ADMIN) => testAdminProof({ userId, now })

function payloadOf(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString('utf8'))
}

beforeEach(() => {
  vi.stubEnv('ODOO_URL', 'https://odoo.test')
  vi.stubEnv('ODOO_WRITE_API_KEY', WRITE_KEY)
  vi.stubEnv('ODOO_DB', '')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('clave de la vista previa (#144)', () => {
  test('la clave liga el contenido exacto, el usuario, el modo y la vigencia', () => {
    const { clave, vence, markers } = issueQuotationKey(proofAt(NOW), CREATE_TARGET, { now: NOW })
    expect(vence).toBe(new Date(NOW + PREVIEW_TTL_MS).toISOString())

    const ok = verifyQuotationKey(proofAt(NOW + 60_000), clave, { kind: 'crear', input: { ...CREATE_INPUT, clave } }, { now: NOW + 60_000 })
    expect(ok.expired).toBe(false)
    expect(ok.markers).toEqual(markers)
    expect(ok.claims).toMatchObject({ v: 1, k: 'crear', u: ADMIN, p: 1, s: null, w: null })
    expect(() => grantPreviewWrite(ok, { now: NOW + 60_000 })).not.toThrow()

    // Content: one more unit in a line is another quotation.
    const changed = { ...CREATE_INPUT, lineas: [CREATE_INPUT.lineas![0], { producto_id: 30888, cantidad: 2, precio: 1 }, CREATE_INPUT.lineas![2]] }
    expect(() => verifyQuotationKey(proofAt(NOW), clave, { kind: 'crear', input: changed }, { now: NOW })).toThrow(PREVIEW_CHANGED_MESSAGE)
    // Another admin, even with a valid proof of their own.
    expect(() => verifyQuotationKey(proofAt(NOW, 'admin-2'), clave, { kind: 'crear', input: CREATE_INPUT }, { now: NOW })).toThrow(
      PREVIEW_KEY_OTHER_ADMIN_MESSAGE,
    )
    // Intent: a create key does not edit.
    expect(() => verifyQuotationKey(proofAt(NOW), clave, { kind: 'editar', input: CREATE_INPUT }, { now: NOW })).toThrow(
      /es de la vista previa para crear una cotización, no para editar la cotización/,
    )

    // Past 30 min it still verifies (for the "ya estaba" checks) but never writes.
    const late = NOW + PREVIEW_TTL_MS
    const expired = verifyQuotationKey(proofAt(late), clave, { kind: 'crear', input: CREATE_INPUT }, { now: late })
    expect(expired.expired).toBe(true)
    expect(expired.markers).toEqual(markers)
    expect(() => grantPreviewWrite(expired, { now: late })).toThrow(PREVIEW_EXPIRED_MESSAGE)
    expect(
      verifyQuotationKey(proofAt(late - 1000), clave, { kind: 'crear', input: CREATE_INPUT }, { now: late - 1000 }).expired,
    ).toBe(false)
  })

  test('sin clave, con clave alterada o sin prueba de administrador vigente no verifica', () => {
    const { clave } = issueQuotationKey(proofAt(NOW), CREATE_TARGET, { now: NOW })
    const expected = { kind: 'crear' as const, input: CREATE_INPUT }
    for (const missing of [undefined, '', '   ', 42]) {
      expect(() => verifyQuotationKey(proofAt(NOW), missing, expected, { now: NOW })).toThrow(PREVIEW_KEY_MISSING_MESSAGE)
    }
    // Another payload under the original MAC: the HMAC binds the exact bytes.
    const [, mac] = clave.split('.')
    const forged = Buffer.from(JSON.stringify({ ...payloadOf(clave), u: 'admin-2' }), 'utf8').toString('base64url')
    for (const bad of [`${forged}.${mac}`, 'abc', `${clave}.x`, clave.replace('.', '')]) {
      expect(() => verifyQuotationKey(proofAt(NOW), bad, expected, { now: NOW })).toThrow(PREVIEW_KEY_INVALID_MESSAGE)
    }
    // An expired proof (or none issued by requireLiveAdmin) never verifies anything.
    expect(() => verifyQuotationKey(proofAt(NOW - 120_000), clave, expected, { now: NOW })).toThrow(OdooError)
    const handMade = { ...proofAt(NOW) }
    expect(() => verifyQuotationKey(handMade, clave, expected, { now: NOW })).toThrow(ADMIN_ONLY_MESSAGE)
  })

  test('el orden de las llaves no importa', () => {
    expect(canonicalJson({ b: 1, a: { d: [{ z: 1, y: 2 }], c: 2 } })).toBe('{"a":{"c":2,"d":[{"y":2,"z":1}]},"b":1}')
    const reordered: QuotationKeyInput = {
      lineas: CREATE_INPUT.lineas!.map((line) => Object.fromEntries(Object.entries(line).reverse())),
      cliente: '#1',
    }
    expect(quotationContentHash(reordered)).toBe(quotationContentHash(CREATE_INPUT))
    const { clave } = issueQuotationKey(proofAt(NOW), CREATE_TARGET, { now: NOW })
    expect(verifyQuotationKey(proofAt(NOW), clave, { kind: 'crear', input: reordered }, { now: NOW }).expired).toBe(false)
  })

  test('la clave de revisar sirve para confirmar (odoo_confirm_quotation manda folio y clave, #155 B2b)', () => {
    const { clave, markers } = issueQuotationKey(proofAt(NOW), REVIEW_TARGET, { now: NOW })
    const confirm = { folio: 'S00912', clave }
    const verified = verifyQuotationKey(proofAt(NOW), clave, { kind: 'confirmar', input: confirm }, { now: NOW })
    expect(verified.markers).toEqual(markers)
    expect(verified.claims).toMatchObject({ k: 'confirmar', p: 1, s: 912, w: '2026-10-17 22:47:43' })
    // The review key confirms; it does not edit.
    expect(() => verifyQuotationKey(proofAt(NOW), clave, { kind: 'editar', input: { folio: 'S00912' } }, { now: NOW })).toThrow(
      /para confirmar la venta, no para editar la cotización/,
    )
  })

  test('descuento 0, espacios y folio en minúsculas no cambian el hash', () => {
    const tidy: QuotationKeyInput = {
      folio: 'S00912',
      lineas: [{ linea_id: 4711, codigo: '5467', marca: 'URREA', cantidad: 3, precio: 950.98 }, { seccion: 'Herramienta' }],
      vigencia: '2026-11-30',
    }
    const messy: QuotationKeyInput = {
      folio: '  s00912 ',
      lineas: [
        { linea_id: 4711, codigo: ' 5467 ', marca: 'URREA ', cantidad: 3, precio: 950.98, descuento: 0, etm: undefined },
        { seccion: ' Herramienta' },
      ],
      vigencia: '2026-11-30 ',
      cliente: undefined,
      clave: 'no es contenido',
    }
    expect(canonicalQuotationInput(messy)).toEqual(canonicalQuotationInput(tidy))
    expect(quotationContentHash(messy)).toBe(quotationContentHash(tidy))
    // A real discount, another line order or a new line is other content.
    const withDiscount = { ...tidy, lineas: [{ ...tidy.lineas![0], descuento: 5 }, tidy.lineas![1]] }
    expect(quotationContentHash(withDiscount)).not.toBe(quotationContentHash(tidy))
    expect(quotationContentHash({ ...tidy, lineas: [...tidy.lineas!].reverse() })).not.toBe(quotationContentHash(tidy))
    expect(quotationContentHash({ ...tidy, lineas: [...tidy.lineas!, { nota: 'x' }] })).not.toBe(quotationContentHash(tidy))
    // Fields the schema may grow are hashed too, never silently skipped.
    const grown = { ...tidy, lineas: [{ ...tidy.lineas![0], clave_sat: '27111600' }, tidy.lineas![1]] }
    expect(quotationContentHash(grown)).not.toBe(quotationContentHash(tidy))
  })

  test('una firma de otra longitud se rechaza sin lanzar', () => {
    const { clave } = issueQuotationKey(proofAt(NOW), CREATE_TARGET, { now: NOW })
    const [payload, mac] = clave.split('.')
    const expected = { kind: 'crear' as const, input: CREATE_INPUT }
    for (const other of [mac.slice(0, -1), `${mac}A`, mac.slice(0, 8), `${mac}=`]) {
      let thrown: unknown
      try {
        verifyQuotationKey(proofAt(NOW), `${payload}.${other}`, expected, { now: NOW })
      } catch (error) {
        thrown = error
      }
      // An OdooError with the user-facing message, never timingSafeEqual's RangeError.
      expect(thrown).toBeInstanceOf(OdooError)
      expect((thrown as Error).message).toBe(PREVIEW_KEY_INVALID_MESSAGE)
    }
  })

  test('otra forma de escribir la misma firma no verifica: el marcador no se puede duplicar', () => {
    const { clave, markers } = issueQuotationKey(proofAt(NOW), CREATE_TARGET, { now: NOW })
    const [payload, mac] = clave.split('.')
    // Same decoded bytes, other spelling: the last base64url char carries 2 unused bits.
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
    const last = alphabet.indexOf(mac.at(-1)!)
    const twin = `${mac.slice(0, -1)}${alphabet[last ^ 1]}`
    expect(Buffer.from(twin, 'base64url')).toEqual(Buffer.from(mac, 'base64url'))
    expect(() => verifyQuotationKey(proofAt(NOW), `${payload}.${twin}`, { kind: 'crear', input: CREATE_INPUT }, { now: NOW })).toThrow(
      PREVIEW_KEY_INVALID_MESSAGE,
    )
    // Surrounding whitespace is trimmed, and the marker stays the one issued.
    const padded = verifyQuotationKey(proofAt(NOW), ` ${clave}\n`, { kind: 'crear', input: CREATE_INPUT }, { now: NOW })
    expect(padded.markers).toEqual(markers)
  })

  test('dos vistas previas iguales dan marcadores distintos', () => {
    const first = issueQuotationKey(proofAt(NOW), CREATE_TARGET, { now: NOW })
    const second = issueQuotationKey(proofAt(NOW), CREATE_TARGET, { now: NOW })
    expect(second.clave).not.toBe(first.clave)
    expect(second.markers.k10).not.toBe(first.markers.k10)
    // Same content: h10 (the duplicate warning) matches; k10 is sha256(clave).
    expect(second.markers.h10).toBe(first.markers.h10)
    expect(first.markers.h10).toBe(quotationContentHash(CREATE_INPUT).slice(0, 10))
    expect(first.markers.k10).toBe(createHash('sha256').update(first.clave).digest('hex').slice(0, 10))
    expect(first.markers).toEqual({ k10: expect.stringMatching(/^[0-9a-f]{10}$/), h10: expect.stringMatching(/^[0-9a-f]{10}$/) })
    // The nonce is what tells them apart: the same nonce, same instant, gives the same key.
    const nonce = () => 'AAAAAAAAAAA'
    expect(issueQuotationKey(proofAt(NOW), CREATE_TARGET, { now: NOW, nonce }).clave).toBe(
      issueQuotationKey(proofAt(NOW), CREATE_TARGET, { now: NOW, nonce }).clave,
    )
  })

  test('sin llave de escritura no hay clave', () => {
    vi.stubEnv('ODOO_WRITE_API_KEY', '')
    expect(() => issueQuotationKey(proofAt(NOW), CREATE_TARGET, { now: NOW })).toThrow(/deshabilitada.*ODOO_WRITE_API_KEY/)
    expect(() => issueProductsAuthorization(proofAt(NOW), PRODUCTS, { now: NOW })).toThrow(/deshabilitada/)

    // Rotating the key voids every pending preview.
    vi.stubEnv('ODOO_WRITE_API_KEY', WRITE_KEY)
    const { clave } = issueQuotationKey(proofAt(NOW), CREATE_TARGET, { now: NOW })
    vi.stubEnv('ODOO_WRITE_API_KEY', 'another-write-key-fedcba9876543210')
    expect(() => verifyQuotationKey(proofAt(NOW), clave, { kind: 'crear', input: CREATE_INPUT }, { now: NOW })).toThrow(
      PREVIEW_KEY_INVALID_MESSAGE,
    )
    vi.stubEnv('ODOO_WRITE_API_KEY', '')
    expect(() => verifyQuotationKey(proofAt(NOW), clave, { kind: 'crear', input: CREATE_INPUT }, { now: NOW })).toThrow(/deshabilitada/)
  })

  test('la clave no lleva la llave ni el contenido: solo su hash', () => {
    const { clave } = issueQuotationKey(proofAt(NOW), CREATE_TARGET, { now: NOW })
    const claims = payloadOf(clave)
    expect(Object.keys(claims).sort()).toEqual(['exp', 'h', 'iat', 'k', 'n', 'p', 's', 'u', 'v', 'w'])
    expect(clave).not.toContain(WRITE_KEY)
    expect(JSON.stringify(claims)).not.toContain('ZZTEST144')
  })

  test('crear no fija venta; editar y confirmar fijan la venta leída', () => {
    expect(() => issueQuotationKey(proofAt(NOW), { ...CREATE_TARGET, saleId: 912, writeDate: '2026-10-17 22:47:43' }, { now: NOW })).toThrow(
      /No pude emitir la clave/,
    )
    expect(() => issueQuotationKey(proofAt(NOW), { ...REVIEW_TARGET, saleId: null }, { now: NOW })).toThrow(/No pude emitir la clave/)
    expect(() => issueQuotationKey(proofAt(NOW), { ...CREATE_TARGET, partnerId: 0 }, { now: NOW })).toThrow(/No pude emitir la clave/)
  })

  test('solo una clave vigente se vuelve permiso de escribir; copias y permisos ajenos no sirven', () => {
    const { clave, markers } = issueQuotationKey(proofAt(NOW), REVIEW_TARGET, { now: NOW })
    const confirm = { kind: 'confirmar' as const, input: { folio: 'S00912' } }
    const verified = verifyQuotationKey(proofAt(NOW), clave, confirm, { now: NOW })
    const grant = grantPreviewWrite(verified, { now: NOW })
    expect(grant).toEqual({ kind: 'confirmar', userId: ADMIN, partnerId: 1, saleId: 912, markers, expiresAt: NOW + PREVIEW_TTL_MS })
    expect(Object.isFrozen(grant) && Object.isFrozen(verified) && Object.isFrozen(verified.claims)).toBe(true)
    const target = { kind: 'confirmar' as const, userId: ADMIN, saleId: 912 }
    expect(() => assertPreviewGrant(grant, target, NOW + PREVIEW_TTL_MS - 1)).not.toThrow()

    // A hand-made "fresh" verification or a copied grant is not one this module minted.
    expect(() => grantPreviewWrite({ ...verified, expired: false }, { now: NOW })).toThrow(PREVIEW_GRANT_MISSING_MESSAGE)
    expect(() => assertPreviewGrant({ ...grant }, target, NOW)).toThrow(PREVIEW_GRANT_MISSING_MESSAGE)
    // Verified at 29 min, granted at 30: the reads in between don't stretch the key.
    const nearlyLate = verifyQuotationKey(proofAt(NOW + PREVIEW_TTL_MS - 60_000), clave, confirm, { now: NOW + PREVIEW_TTL_MS - 60_000 })
    expect(nearlyLate.expired).toBe(false)
    expect(() => grantPreviewWrite(nearlyLate, { now: NOW + PREVIEW_TTL_MS })).toThrow(PREVIEW_EXPIRED_MESSAGE)

    // The writer's own check: same admin, operation and sale, and the 30 min again at write time.
    expect(() => assertPreviewGrant(grant, { ...target, userId: 'admin-2' }, NOW)).toThrow(PREVIEW_KEY_OTHER_ADMIN_MESSAGE)
    expect(() => assertPreviewGrant(grant, { ...target, kind: 'editar' }, NOW)).toThrow(/para confirmar la venta, no para editar/)
    expect(() => assertPreviewGrant(grant, { ...target, saleId: 913 }, NOW)).toThrow(PREVIEW_CHANGED_MESSAGE)
    expect(() => assertPreviewGrant(grant, target, NOW + PREVIEW_TTL_MS)).toThrow(PREVIEW_EXPIRED_MESSAGE)

    // Creating also pins the partner the preview resolved.
    const created = grantPreviewWrite(
      verifyQuotationKey(proofAt(NOW), issueQuotationKey(proofAt(NOW), CREATE_TARGET, { now: NOW }).clave, { kind: 'crear', input: CREATE_INPUT }, { now: NOW }),
      { now: NOW },
    )
    const createTarget = { kind: 'crear' as const, userId: ADMIN, saleId: null }
    expect(() => assertPreviewGrant(created, { ...createTarget, partnerId: 1 }, NOW)).not.toThrow()
    expect(() => assertPreviewGrant(created, { ...createTarget, partnerId: 17 }, NOW)).toThrow(PREVIEW_CHANGED_MESSAGE)
  })

  test('emitir la clave exige una prueba de administrador vigente', () => {
    expect(() => issueQuotationKey(proofAt(NOW - 120_000), CREATE_TARGET, { now: NOW })).toThrow(/verificación de administrador venció/)
    expect(() => issueQuotationKey({ ...proofAt(NOW) }, CREATE_TARGET, { now: NOW })).toThrow(ADMIN_ONLY_MESSAGE)
  })
})

describe('autorización del alta de productos (#144)', () => {
  test('liga la lista exacta, el administrador y la vigencia', () => {
    const { autorizacion, vence } = issueProductsAuthorization(proofAt(NOW), PRODUCTS, { now: NOW })
    expect(vence).toBe(new Date(NOW + PREVIEW_TTL_MS).toISOString())
    const reordered = PRODUCTS.map((p) => Object.fromEntries(Object.entries(p).reverse()))
    expect(verifyProductsAuthorization(proofAt(NOW), autorizacion, reordered, { now: NOW })).toMatchObject({ k: 'products', u: ADMIN })

    expect(() => verifyProductsAuthorization(proofAt(NOW), autorizacion, [{ ...PRODUCTS[0], precio: 2 }], { now: NOW })).toThrow(
      PRODUCTS_CHANGED_MESSAGE,
    )
    expect(() => verifyProductsAuthorization(proofAt(NOW, 'admin-2'), autorizacion, PRODUCTS, { now: NOW })).toThrow(
      PRODUCTS_OTHER_ADMIN_MESSAGE,
    )
    const late = NOW + PREVIEW_TTL_MS
    expect(() => verifyProductsAuthorization(proofAt(late), autorizacion, PRODUCTS, { now: late })).toThrow(PRODUCTS_EXPIRED_MESSAGE)
  })

  test('sin autorización, o con la clave de la cotización en su lugar, no hay alta', () => {
    const { clave } = issueQuotationKey(proofAt(NOW), CREATE_TARGET, { now: NOW })
    for (const bad of [undefined, '', 'cualquier-cosa', clave]) {
      expect(() => verifyProductsAuthorization(proofAt(NOW), bad, PRODUCTS, { now: NOW })).toThrow(PRODUCTS_UNAUTHORIZED_MESSAGE)
    }
    // And the other way around: an authorization is not a quotation key.
    const { autorizacion } = issueProductsAuthorization(proofAt(NOW), PRODUCTS, { now: NOW })
    expect(() => verifyQuotationKey(proofAt(NOW), autorizacion, { kind: 'crear', input: CREATE_INPUT }, { now: NOW })).toThrow(
      PREVIEW_KEY_INVALID_MESSAGE,
    )
  })

  test('emitir y verificar la autorización exigen una prueba de administrador vigente', () => {
    const { autorizacion } = issueProductsAuthorization(proofAt(NOW), PRODUCTS, { now: NOW })
    const stale = proofAt(NOW - 120_000)
    const copied = { ...proofAt(NOW) }
    expect(() => issueProductsAuthorization(stale, PRODUCTS, { now: NOW })).toThrow(/verificación de administrador venció/)
    expect(() => issueProductsAuthorization(copied, PRODUCTS, { now: NOW })).toThrow(ADMIN_ONLY_MESSAGE)
    // The only server gate of odoo_save_product besides requireLiveAdmin.
    expect(() => verifyProductsAuthorization(stale, autorizacion, PRODUCTS, { now: NOW })).toThrow(/verificación de administrador venció/)
    expect(() => verifyProductsAuthorization(copied, autorizacion, PRODUCTS, { now: NOW })).toThrow(ADMIN_ONLY_MESSAGE)
  })
})
