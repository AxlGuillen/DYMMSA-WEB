/** Separator palette (#73): auto rotation by index, manual override, unknown DB values. */

import { describe, test, expect } from 'vitest'
import {
  SEPARATOR_COLOR_KEYS,
  SEPARATOR_PALETTE,
  autoSeparatorColor,
  isSeparatorColor,
  resolveSeparatorColor,
  separatorRowClass,
} from '@/lib/separator-palette'

describe('separator-palette', () => {
  test('la rotación recorre la paleta y da la vuelta', () => {
    const n = SEPARATOR_COLOR_KEYS.length
    expect(autoSeparatorColor(0)).toBe(SEPARATOR_COLOR_KEYS[0])
    expect(autoSeparatorColor(n - 1)).toBe(SEPARATOR_COLOR_KEYS[n - 1])
    expect(autoSeparatorColor(n)).toBe(SEPARATOR_COLOR_KEYS[0])
    expect(autoSeparatorColor(n + 2)).toBe(SEPARATOR_COLOR_KEYS[2])
  })

  test('un índice inválido cae al primer color, no revienta', () => {
    expect(autoSeparatorColor(-3)).toBe(SEPARATOR_COLOR_KEYS[0])
    expect(autoSeparatorColor(2.7)).toBe(SEPARATOR_COLOR_KEYS[0])
  })

  test('el override manual gana sobre el automático', () => {
    expect(resolveSeparatorColor('rose', 0)).toBe('rose')
    expect(separatorRowClass('rose', 0)).toBe(SEPARATOR_PALETTE.rose.row)
  })

  test('null/undefined o un valor desconocido en BD → automático', () => {
    expect(resolveSeparatorColor(null, 1)).toBe(autoSeparatorColor(1))
    expect(resolveSeparatorColor(undefined, 2)).toBe(autoSeparatorColor(2))
    expect(resolveSeparatorColor('fucsia-fantasma', 3)).toBe(autoSeparatorColor(3))
  })

  test('isSeparatorColor valida contra la paleta', () => {
    expect(isSeparatorColor('teal')).toBe(true)
    expect(isSeparatorColor('fucsia-fantasma')).toBe(false)
    expect(isSeparatorColor(null)).toBe(false)
  })

  test('cada tono trae fondo opaco (color-mix) con variante dark y hover fijado', () => {
    for (const key of SEPARATOR_COLOR_KEYS) {
      const row = SEPARATOR_PALETTE[key].row
      // Opaque via color-mix, never alpha: the sticky actions column inherits the
      // background with bg-inherit (same rule as notSoldRowClass).
      expect(row, key).toContain('bg-[color-mix')
      expect(row, key).toContain('dark:bg-[color-mix')
      // shadcn's TableRow ships hover:bg-muted/50 — each tone overrides it.
      expect(row, key).toContain('hover:bg-[color-mix')
      expect(row, key).toContain('border-l-4')
    }
  })
})
