/**
 * SAT product keys (UNSPSC) for the Odoo preview (#154, ADR-040): which words to search and how the
 * hits rank. Pure; the ONE read lives in src/lib/mcp/tools/odoo/resolve.ts.
 */

import { fold } from '@/lib/text'

/** The SAT's "no existe en el catálogo": stamping needs the real key, so it is never written. */
export const SAT_PLACEHOLDER = '01010101'

/** Product keys are 8 digits; product.unspsc.code also holds the UoM codes (H87…), never suggested. */
export const SAT_KEY = /^\d{8}$/

export const MAX_SAT_SUGGESTIONS = 3

const MAX_TERMS_PER_TEXT = 4
const MIN_TERM_LENGTH = 4

// Folded; shorter words never get here. Brands and sizes match no SAT name and only cost OR slots.
const STOPWORDS: ReadonlySet<string> = new Set([
  'para', 'como', 'tipo', 'marca', 'modelo', 'pieza', 'pulgada', 'medida', 'color', 'negro', 'negra', 'blanco',
  'blanca', 'rojo', 'roja', 'azul', 'verde', 'gris', 'amarillo', 'chico', 'chica', 'mediano', 'mediana', 'grande',
  'largo', 'larga', 'corto', 'corta', 'nuevo', 'nueva', 'urrea', 'surtek',
])

export interface SatCode {
  readonly code: string
  readonly name: string
}

export interface SatSuggestion {
  readonly clave: string
  readonly nombre: string
}

/** Spanish plural cut short, so an ilike substring also hits the singular ("llaves" → "llav"). */
function stem(word: string): string {
  if (word.length > 5 && word.endsWith('es')) return word.slice(0, -2)
  if (word.length > 4 && word.endsWith('s')) return word.slice(0, -1)
  return word
}

/** Up to 4 words of a description, lowercase with their accents (ilike may not ignore them). */
export function satSearchTerms(text: string): string[] {
  const terms: string[] = []
  const seen = new Set<string>()
  for (const word of text.toLowerCase().split(/[^a-z0-9áéíóúüñ]+/)) {
    if (!word || /\d/.test(word)) continue
    const singular = word.endsWith('s') ? word.slice(0, -1) : word
    if (STOPWORDS.has(fold(word)) || STOPWORDS.has(fold(singular))) continue
    const term = stem(word)
    const key = fold(term)
    if (key.length < MIN_TERM_LENGTH || seen.has(key)) continue
    seen.add(key)
    terms.push(term)
    if (terms.length === MAX_TERMS_PER_TEXT) break
  }
  return terms
}

const wordsOf = (text: string) => fold(text).split(/[^a-z0-9]+/).filter(Boolean)

const startsAWord = (words: readonly string[], key: string) => words.some((word) => word.startsWith(key))

/** Odoo has no relevance order: most words at a word start first, then the shortest name, then the code. */
export function rankSatSuggestions(
  terms: readonly string[],
  rows: readonly SatCode[],
  max: number = MAX_SAT_SUGGESTIONS,
): SatSuggestion[] {
  const keys = [...new Set(terms.map(fold))]
  if (keys.length === 0) return []
  const seen = new Set<string>()
  return rows
    .flatMap((row) => {
      if (!SAT_KEY.test(row.code) || row.code === SAT_PLACEHOLDER || seen.has(row.code)) return []
      seen.add(row.code)
      const words = wordsOf(row.name)
      const hits = keys.filter((key) => startsAWord(words, key)).length
      // Only inside a longer word ("tornillo" in "destornilladores") is not a match.
      return hits > 0 ? [{ row, hits, length: words.length }] : []
    })
    .sort((a, b) => b.hits - a.hits || a.length - b.length || a.row.code.localeCompare(b.row.code))
    .slice(0, max)
    .map(({ row }) => ({ clave: row.code, nombre: row.name.trim() }))
}

/** The one suggestion with every word: what a categoria_sat asked for by name, proposed for the admin to confirm. */
export function proposedSatKey(terms: readonly string[], suggestions: readonly SatSuggestion[]): string | null {
  const keys = [...new Set(terms.map(fold))]
  if (keys.length === 0) return null
  const complete = suggestions.filter((s) => {
    const words = wordsOf(s.nombre)
    return keys.every((key) => startsAWord(words, key))
  })
  return complete.length === 1 ? complete[0].clave : null
}
