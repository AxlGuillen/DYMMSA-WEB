/**
 * Store de sonido (issue #28). El default se decide al crear el store
 * (import), así que el caso reduced-motion re-importa el módulo con
 * matchMedia mockeado y localStorage limpio (sin persist que lo pise).
 */

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
    mockMatchMedia(true) // el default diría "apagado"...
    localStorage.setItem(
      'dymmsa-sound',
      JSON.stringify({ state: { soundEnabled: true }, version: 0 }),
    )
    const { useSoundStore } = await import('@/stores/soundStore')
    // ...pero el usuario lo había activado a mano.
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
