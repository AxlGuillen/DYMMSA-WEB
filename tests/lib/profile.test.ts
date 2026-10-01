import { describe, test, expect } from 'vitest'
import { parseDisplayName, parseNss, withAvatarUrl } from '@/lib/profile'

describe('profile', () => {
  test('nombre: recorta, exige texto y tope de 80', () => {
    expect(parseDisplayName('  Tania  ')).toEqual({ value: 'Tania' })
    expect(parseDisplayName(42)).toEqual({ error: 'El nombre no puede quedar vacío' })
    expect(parseDisplayName('x'.repeat(81))).toEqual({ error: 'El nombre no puede pasar de 80 caracteres' })
  })

  test('NSS: null o vacío lo borran; se normaliza; otro tipo es error', () => {
    expect(parseNss(null)).toEqual({ value: null })
    expect(parseNss(' - ')).toEqual({ value: null })
    expect(parseNss('1234-5678-903')).toEqual({ value: '12345678903' })
    expect(parseNss(12345678903)).toEqual({ error: 'El NSS debe ser texto' })
    expect(parseNss('12345678904')).toHaveProperty('error')
  })

  test('avatar_url solo existe si hay ruta', () => {
    expect(withAvatarUrl({ avatar_path: null }).avatar_url).toBeNull()
    expect(withAvatarUrl({ avatar_path: 'u1/a.webp' }).avatar_url).toMatch(/\/storage\/v1\/object\/public\/avatars\/u1\/a\.webp$/)
  })
})
