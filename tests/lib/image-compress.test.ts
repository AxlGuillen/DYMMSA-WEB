/**
 * shouldCompress — decisión pura de qué tipos se comprimen. El re-encodeo por
 * canvas (compressImage) es DOM/browser y se prueba manualmente / E2E.
 */

import { describe, test, expect } from 'vitest'
import { shouldCompress } from '@/lib/image-compress'

describe('shouldCompress', () => {
  test('comprime raster (png/jpeg/webp)', () => {
    expect(shouldCompress('image/png')).toBe(true)
    expect(shouldCompress('image/jpeg')).toBe(true)
    expect(shouldCompress('image/webp')).toBe(true)
  })

  test('NO comprime GIF (preserva animación) ni otros tipos', () => {
    expect(shouldCompress('image/gif')).toBe(false)
    expect(shouldCompress('application/pdf')).toBe(false)
    expect(shouldCompress('')).toBe(false)
  })
})
