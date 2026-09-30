import { describe, test, expect, vi, afterEach } from 'vitest'
import { avatarPublicUrl, avatarTone, centerSquare, initials } from '@/lib/avatar'

afterEach(() => vi.unstubAllEnvs())

describe('avatar', () => {
  test.each([
    ['Tania Cruz López', 'TC'],
    ['axl', 'A'],
    ['  Ángel   ruiz ', 'ÁR'],
    ['', '?'],
  ])('iniciales de "%s" → %s', (name, expected) => {
    expect(initials(name)).toBe(expected)
  })

  test('el color es estable por id y reparte entre ids distintos', () => {
    const id = '00000000-0000-0000-0000-0000000000a2'
    expect(avatarTone(id)).toBe(avatarTone(id))
    const tones = new Set(Array.from({ length: 40 }, (_, i) => avatarTone(`user-${i}`)))
    expect(tones.size).toBeGreaterThan(4)
  })

  test('recorta el cuadro centrado', () => {
    expect(centerSquare(400, 300)).toEqual({ x: 50, y: 0, size: 300 })
    expect(centerSquare(300, 401)).toEqual({ x: 0, y: 50, size: 300 })
    expect(centerSquare(256, 256)).toEqual({ x: 0, y: 0, size: 256 })
  })

  test('la URL pública tolera una diagonal final en el origen', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://x.supabase.co/')
    expect(avatarPublicUrl('u1/a.webp')).toBe('https://x.supabase.co/storage/v1/object/public/avatars/u1/a.webp')
    expect(avatarPublicUrl(null)).toBeNull()
  })
})
