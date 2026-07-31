/**
 * Guard de open-redirect del parámetro `?next=` (ADR-023). Lo comparten el
 * proxy y la página de login — de ahí que tenga test propio.
 */

import { describe, test, expect } from 'vitest'
import { isSafeNext } from '@/lib/safe-next'

describe('isSafeNext', () => {
  test('acepta rutas relativas del mismo origen (con query y hash)', () => {
    expect(isSafeNext('/dashboard')).toBe(true)
    expect(isSafeNext('/oauth/consent?authorization_id=abc')).toBe(true)
    expect(isSafeNext('/dashboard#seccion')).toBe(true)
    expect(isSafeNext('/')).toBe(true)
  })

  test('rechaza vacío o ausente', () => {
    expect(isSafeNext(null)).toBe(false)
    expect(isSafeNext(undefined)).toBe(false)
    expect(isSafeNext('')).toBe(false)
  })

  test('rechaza URLs absolutas y esquemas', () => {
    expect(isSafeNext('https://evil.com')).toBe(false)
    expect(isSafeNext('http://evil.com')).toBe(false)
    expect(isSafeNext('javascript:alert(1)')).toBe(false)
    expect(isSafeNext('dashboard')).toBe(false) // sin la barra inicial
  })

  test('REGLA: rechaza protocol-relative `//host`', () => {
    expect(isSafeNext('//evil.com')).toBe(false)
    expect(isSafeNext('//evil.com/path')).toBe(false)
  })

  test('REGLA: rechaza `/\\host` — el navegador normaliza la barra invertida a `/`', () => {
    // Sin esto, `/\evil.com` termina siendo `//evil.com`: otro origen.
    expect(isSafeNext('/\\evil.com')).toBe(false)
    expect(isSafeNext('/\\/evil.com')).toBe(false)
  })
})
