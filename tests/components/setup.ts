import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

// Desmonta el árbol renderizado entre tests (evita fugas de DOM).
afterEach(() => cleanup())

// Polyfills que Radix/shadcn usan y jsdom no implementa.
if (!window.matchMedia) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
}

if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}

// crypto.randomUUID — lo usan addItem/addSeparatorAfter del quotationStore.
if (!globalThis.crypto?.randomUUID) {
  const c = (globalThis.crypto ??= {} as Crypto)
  ;(c as { randomUUID: () => `${string}-${string}-${string}-${string}-${string}` }).randomUUID =
    () => `test-${Math.random().toString(16).slice(2)}-${Date.now().toString(16)}` as never
}

// navigator.clipboard — lo usa QuotePreview (handleCopyUnmatched).
if (!navigator.clipboard) {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    configurable: true,
  })
}
