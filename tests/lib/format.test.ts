import { describe, test, expect } from 'vitest'
import {
  formatRelative,
  formatISODate,
  normalizeString,
  sanitizeFilename,
  parseNumber,
  parseInteger,
} from '@/lib/format'

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Creates a Date that is `ms` milliseconds before `now`. */
function ago(now: Date, ms: number): string {
  return new Date(now.getTime() - ms).toISOString()
}

const NOW = new Date('2026-05-25T12:00:00Z')
const MIN = 60_000
const HOUR = 3_600_000
const DAY = 86_400_000

// ─── formatRelative ─────────────────────────────────────────────────────────

describe('formatRelative', () => {
  test('returns "hace un momento" for < 2 minutes ago', () => {
    expect(formatRelative(ago(NOW, 30_000), NOW)).toBe('hace un momento')
    expect(formatRelative(ago(NOW, MIN), NOW)).toBe('hace un momento')
  })

  test('returns "hace N min" for 2–59 minutes ago', () => {
    expect(formatRelative(ago(NOW, 2 * MIN), NOW)).toBe('hace 2 min')
    expect(formatRelative(ago(NOW, 45 * MIN), NOW)).toBe('hace 45 min')
    expect(formatRelative(ago(NOW, 59 * MIN), NOW)).toBe('hace 59 min')
  })

  test('returns "hace Nh" for 1–23 hours ago', () => {
    expect(formatRelative(ago(NOW, HOUR), NOW)).toBe('hace 1h')
    expect(formatRelative(ago(NOW, 5 * HOUR), NOW)).toBe('hace 5h')
    expect(formatRelative(ago(NOW, 23 * HOUR), NOW)).toBe('hace 23h')
  })

  test('returns "ayer" for exactly 1 day ago', () => {
    expect(formatRelative(ago(NOW, DAY), NOW)).toBe('ayer')
  })

  test('returns "hace N días" for 2–6 days ago', () => {
    expect(formatRelative(ago(NOW, 2 * DAY), NOW)).toBe('hace 2 días')
    expect(formatRelative(ago(NOW, 6 * DAY), NOW)).toBe('hace 6 días')
  })

  test('returns "hace N sem" for 7–29 days ago', () => {
    expect(formatRelative(ago(NOW, 7 * DAY), NOW)).toBe('hace 1 sem')
    expect(formatRelative(ago(NOW, 14 * DAY), NOW)).toBe('hace 2 sem')
    expect(formatRelative(ago(NOW, 21 * DAY), NOW)).toBe('hace 3 sem')
  })

  test('returns absolute date for >= 30 days ago', () => {
    const result = formatRelative(ago(NOW, 30 * DAY), NOW)
    // Should be a date string, not a relative one
    expect(result).not.toMatch(/^hace/)
    expect(result).not.toBe('ayer')
    expect(result.length).toBeGreaterThan(4)
  })
})

// ─── formatISODate ───────────────────────────────────────────────────────────

describe('formatISODate', () => {
  test('formats a Date object to YYYY-MM-DD', () => {
    expect(formatISODate(new Date('2026-05-25T00:00:00Z'))).toBe('2026-05-25')
    expect(formatISODate(new Date('2026-01-01T23:59:59Z'))).toBe('2026-01-01')
  })

  test('returns a 10-character ISO date string', () => {
    const result = formatISODate(new Date())
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

// ─── normalizeString ─────────────────────────────────────────────────────────

describe('normalizeString', () => {
  test('converts to lowercase', () => {
    expect(normalizeString('HELLO')).toBe('hello')
    expect(normalizeString('MixedCase')).toBe('mixedcase')
  })

  test('trims surrounding whitespace', () => {
    expect(normalizeString('  hello  ')).toBe('hello')
    expect(normalizeString('\thello\n')).toBe('hello')
  })

  test('handles already normalized strings', () => {
    expect(normalizeString('hello')).toBe('hello')
  })

  test('handles empty string', () => {
    expect(normalizeString('')).toBe('')
    expect(normalizeString('   ')).toBe('')
  })
})

// ─── sanitizeFilename ────────────────────────────────────────────────────────

describe('sanitizeFilename', () => {
  test('replaces spaces with underscores', () => {
    expect(sanitizeFilename('my file')).toBe('my_file')
  })

  test('replaces special characters with underscores', () => {
    expect(sanitizeFilename('order/2026-05-25')).toBe('order_2026_05_25')
    // toLowerCase() runs after replace, so uppercase letters are lowercased too
    expect(sanitizeFilename('cliente: ABC')).toBe('cliente__abc')
  })

  test('converts to lowercase', () => {
    expect(sanitizeFilename('MyFile')).toBe('myfile')
    expect(sanitizeFilename('ORDEN_URREA')).toBe('orden_urrea')
  })

  test('keeps alphanumeric characters unchanged', () => {
    expect(sanitizeFilename('abc123')).toBe('abc123')
  })

  test('handles empty string', () => {
    expect(sanitizeFilename('')).toBe('')
  })
})

// ─── parseNumber ─────────────────────────────────────────────────────────────

describe('parseNumber', () => {
  test('parses valid integer strings', () => {
    expect(parseNumber('42')).toBe(42)
    expect(parseNumber('0')).toBe(0)
    expect(parseNumber('-10')).toBe(-10)
  })

  test('parses valid float strings', () => {
    expect(parseNumber('3.14')).toBe(3.14)
    expect(parseNumber('1234.56')).toBe(1234.56)
  })

  test('parses numeric values directly', () => {
    expect(parseNumber(100)).toBe(100)
    expect(parseNumber(0.5)).toBe(0.5)
  })

  test('returns null for empty string', () => {
    expect(parseNumber('')).toBeNull()
  })

  test('returns null for null and undefined', () => {
    expect(parseNumber(null)).toBeNull()
    expect(parseNumber(undefined)).toBeNull()
  })

  test('returns null for fully non-numeric strings', () => {
    expect(parseNumber('abc')).toBeNull()
  })

  test('parses leading numeric portion (parseFloat behavior)', () => {
    // parseFloat('12px') === 12 — stops at first non-numeric char
    expect(parseNumber('12px')).toBe(12)
  })
})

// ─── parseInteger ────────────────────────────────────────────────────────────

describe('parseInteger', () => {
  test('parses valid integer strings', () => {
    expect(parseInteger('10')).toBe(10)
    expect(parseInteger('0')).toBe(0)
    expect(parseInteger('-5')).toBe(-5)
  })

  test('truncates floats to integer', () => {
    expect(parseInteger('3.9')).toBe(3)
    expect(parseInteger('99.99')).toBe(99)
  })

  test('parses numeric values directly', () => {
    expect(parseInteger(7)).toBe(7)
  })

  test('returns null for empty string', () => {
    expect(parseInteger('')).toBeNull()
  })

  test('returns null for null and undefined', () => {
    expect(parseInteger(null)).toBeNull()
    expect(parseInteger(undefined)).toBeNull()
  })

  test('returns null for fully non-numeric strings', () => {
    expect(parseInteger('abc')).toBeNull()
  })

  test('parses leading numeric portion (parseInt behavior)', () => {
    // parseInt('10px', 10) === 10 — stops at first non-numeric char
    expect(parseInteger('10px')).toBe(10)
  })
})
