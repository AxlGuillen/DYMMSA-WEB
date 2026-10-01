import { describe, test, expect } from 'vitest'
import { maskNss, normalizeNss, nssError } from '@/lib/nss'

describe('nss', () => {
  test('acepta un NSS con dígito verificador correcto', () => {
    expect(nssError('12345678903')).toBeNull()
  })

  test('normaliza espacios y guiones', () => {
    expect(normalizeNss(' 1234-5678 903 ')).toBe('12345678903')
  })

  test.each([
    ['abc45678903', 'El NSS solo lleva números'],
    ['1234567890', 'El NSS debe tener 11 dígitos'],
    ['123456789031', 'El NSS debe tener 11 dígitos'],
    ['12345678904', 'El NSS no es válido: revisa que no falte o sobre un dígito'],
    ['21345678903', 'El NSS no es válido: revisa que no falte o sobre un dígito'],
  ])('%s → %s', (nss, message) => {
    expect(nssError(nss)).toBe(message)
  })

  test('oculta todo menos los últimos 4', () => {
    expect(maskNss('12345678903')).toBe('•••••••8903')
  })
})
