import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

// Unmount the rendered tree between tests (avoids DOM leaks).
afterEach(() => cleanup())

// Polyfills Radix/shadcn need and jsdom lacks.
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

// Radix (Select, Dropdown) uses Pointer Capture and scrollIntoView; jsdom has neither.
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false
  Element.prototype.setPointerCapture = () => {}
  Element.prototype.releasePointerCapture = () => {}
}
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {}
}

// crypto.randomUUID — used by quotationStore's addItem/addSeparatorAfter.
if (!globalThis.crypto?.randomUUID) {
  const c = (globalThis.crypto ??= {} as Crypto)
  ;(c as { randomUUID: () => `${string}-${string}-${string}-${string}-${string}` }).randomUUID =
    () => `test-${Math.random().toString(16).slice(2)}-${Date.now().toString(16)}` as never
}

// navigator.clipboard — used by QuotePreview (handleCopyUnmatched).
if (!navigator.clipboard) {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    configurable: true,
  })
}
