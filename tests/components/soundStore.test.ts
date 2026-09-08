/** Sound store (#28): the default is decided at import, so the reduced-motion case re-imports the module. */

import { describe, test, expect, beforeEach, vi } from 'vitest'

function mockMatchMedia(matches: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
}

describe('soundStore', () => {
  beforeEach(() => {
    vi.resetModules()
    localStorage.clear()
  })

  test('default: activado cuando no hay preferencia de menos movimiento', async () => {
    mockMatchMedia(false)
    const { useSoundStore } = await import('@/stores/soundStore')
    expect(useSoundStore.getState().soundEnabled).toBe(true)
  })

  test('default: apagado con prefers-reduced-motion (proxy de "no molestar")', async () => {
    mockMatchMedia(true)
    const { useSoundStore } = await import('@/stores/soundStore')
    expect(useSoundStore.getState().soundEnabled).toBe(false)
  })

  test('la preferencia persistida gana sobre el default', async () => {
    mockMatchMedia(true) // the default would say "off"...
    localStorage.setItem(
      'dymmsa-sound',
      JSON.stringify({ state: { soundEnabled: true }, version: 0 }),
    )
    const { useSoundStore } = await import('@/stores/soundStore')
    // ...but the user had turned it on by hand.
    expect(useSoundStore.getState().soundEnabled).toBe(true)
  })

  test('toggleSound alterna', async () => {
    mockMatchMedia(false)
    const { useSoundStore } = await import('@/stores/soundStore')
    useSoundStore.getState().toggleSound()
    expect(useSoundStore.getState().soundEnabled).toBe(false)
    useSoundStore.getState().toggleSound()
    expect(useSoundStore.getState().soundEnabled).toBe(true)
  })
})
