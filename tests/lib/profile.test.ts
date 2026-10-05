import { describe, test, expect } from 'vitest'
import { parseDisplayName, parseHourlyRate, parseNss, presentProfile } from '@/lib/profile'

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
    expect(presentProfile({ avatar_path: null }).avatar_url).toBeNull()
    expect(presentProfile({ avatar_path: 'u1/a.webp' }).avatar_url).toMatch(/\/storage\/v1\/object\/public\/avatars\/u1\/a\.webp$/)
  })
})

describe('tarifa por hora', () => {
  test('presentProfile convierte la tarifa que llega como texto; parseHourlyRate valida la entrada del admin', () => {
    expect(presentProfile({ avatar_path: null, hourly_rate: '52.00' }).hourly_rate).toBe(52)
    expect(parseHourlyRate(null)).toEqual({ value: null })
    expect(parseHourlyRate(60)).toEqual({ value: 60 })
    expect(parseHourlyRate(-1)).toHaveProperty('error')
    expect(parseHourlyRate('abc')).toHaveProperty('error')
  })
})
