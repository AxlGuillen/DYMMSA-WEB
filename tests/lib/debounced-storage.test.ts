import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { createDebouncedStorage } from '@/lib/debounced-storage'

/** Backing en memoria que registra las escrituras reales. */
function makeBacking() {
  const map = new Map<string, string>()
  return {
    map,
    getItem: vi.fn((k: string) => map.get(k) ?? null),
    setItem: vi.fn((k: string, v: string) => void map.set(k, v)),
    removeItem: vi.fn((k: string) => void map.delete(k)),
  }
}

describe('createDebouncedStorage', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  test('coalesce varias escrituras en una sola tras el delay', () => {
    const backing = makeBacking()
    const storage = createDebouncedStorage(backing, 500)

    storage.setItem('k', 'a')
    storage.setItem('k', 'b')
    storage.setItem('k', 'c')
    expect(backing.setItem).not.toHaveBeenCalled() // aún nada escrito

    vi.advanceTimersByTime(500)
    expect(backing.setItem).toHaveBeenCalledTimes(1)
    expect(backing.setItem).toHaveBeenCalledWith('k', 'c') // solo el último valor
  })

  test('getItem sirve el valor pendiente (read-your-writes) antes del flush', () => {
    const backing = makeBacking()
    const storage = createDebouncedStorage(backing, 500)

    backing.map.set('k', 'viejo')
    storage.setItem('k', 'nuevo')
    expect(storage.getItem('k')).toBe('nuevo') // pendiente, sin tocar backing
    expect(backing.setItem).not.toHaveBeenCalled()
  })

  test('flush() fuerza la escritura pendiente y limpia el timer', () => {
    const backing = makeBacking()
    const storage = createDebouncedStorage(backing, 500)

    storage.setItem('k', 'v')
    storage.flush()
    expect(backing.setItem).toHaveBeenCalledExactlyOnceWith('k', 'v')

    // Tras flush no queda timer que dispare otra escritura.
    vi.advanceTimersByTime(500)
    expect(backing.setItem).toHaveBeenCalledTimes(1)
  })

  test('removeItem cancela la escritura pendiente y borra en backing', () => {
    const backing = makeBacking()
    const storage = createDebouncedStorage(backing, 500)

    storage.setItem('k', 'v')
    storage.removeItem('k')
    vi.advanceTimersByTime(500)

    expect(backing.setItem).not.toHaveBeenCalled() // la pendiente se canceló
    expect(backing.removeItem).toHaveBeenCalledWith('k')
  })

  test('sin backing (SSR) no truena y descarta lo pendiente en el flush', () => {
    const storage = createDebouncedStorage(undefined, 500)
    expect(() => {
      storage.setItem('k', 'v')
      storage.flush()
      storage.getItem('k')
    }).not.toThrow()
  })
})
