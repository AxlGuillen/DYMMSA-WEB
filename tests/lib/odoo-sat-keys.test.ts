/** SAT key suggestions (#154, ADR-040): the words searched and the in-memory rank; nothing reaches Odoo. */

import { describe, test, expect } from 'vitest'
import { MAX_SAT_SUGGESTIONS, proposedSatKey, rankSatSuggestions, SAT_PLACEHOLDER, satSearchTerms } from '@/lib/odoo/sat-keys'

const CATALOG = [
  { code: '31211500', name: 'Pinturas' },
  { code: '31211507', name: 'Pinturas en aerosol' },
  { code: '31211508', name: 'Pinturas acrílicas' },
  { code: '27112003', name: 'Brochas de pintura' },
  { code: '27111700', name: 'Llaves' },
  { code: '27111701', name: 'Llaves de tuercas' },
  { code: '27111500', name: 'Destornilladores' },
  { code: '31161500', name: 'Tornillos' },
  { code: 'H87', name: 'Pieza de pintura' },
  { code: SAT_PLACEHOLDER, name: 'No existe en el catálogo de pinturas' },
]

describe('palabras que se buscan', () => {
  test('sin números, relleno ni marcas; el plural se corta para que ilike encuentre también el singular', () => {
    expect(satSearchTerms('Pinturas en aerosol')).toEqual(['pintura', 'aerosol'])
    expect(satSearchTerms('Brocha de 4 pulgadas')).toEqual(['brocha'])
    expect(satSearchTerms('5467 Mango articulado cromado 1/2" URREA')).toEqual(['mango', 'articulado', 'cromado'])
    expect(satSearchTerms('LLAVES combinadas')).toEqual(['llav', 'combinada'])
    expect(satSearchTerms('Cables eléctricos')).toEqual(['cabl', 'eléctrico'])
  })

  test('cada palabra una vez, hasta cuatro, con sus acentos para el ilike', () => {
    expect(satSearchTerms('Llave llaves LLAVE')).toEqual(['llave', 'llav'])
    // Under four letters is dropped ("uno", "dos"), and the fifth word on never travels.
    expect(satSearchTerms('uno dos tres cuatro cinco seis siete')).toEqual(['tres', 'cuatro', 'cinco', 'seis'])
    expect(satSearchTerms('de la 1/2 x 3 "')).toEqual([])
  })
})

describe('orden de las sugerencias', () => {
  test('primero la que trae más palabras al inicio de una palabra, luego la de nombre más corto', () => {
    expect(rankSatSuggestions(['pintura', 'aerosol'], CATALOG)).toEqual([
      { clave: '31211507', nombre: 'Pinturas en aerosol' },
      { clave: '31211500', nombre: 'Pinturas' },
      { clave: '31211508', nombre: 'Pinturas acrílicas' },
    ])
  })

  test('nunca la de medida (H87) ni 01010101, ni una palabra metida dentro de otra', () => {
    const codes = rankSatSuggestions(['tornillo'], CATALOG).map((s) => s.clave)
    expect(codes).toEqual(['31161500'])
    expect(rankSatSuggestions(['pieza', 'pintura', 'catalogo'], CATALOG).map((s) => s.clave)).not.toContain('H87')
    expect(rankSatSuggestions(['existe', 'catalogo'], CATALOG)).toEqual([])
  })

  test('sin acentos ni mayúsculas en la comparación, máximo tres y sin repetir', () => {
    const twice = [...CATALOG, { code: '31211508', name: 'Pinturas acrílicas' }]
    const suggestions = rankSatSuggestions(['PINTURA', 'acrilica'], twice)
    expect(suggestions[0]).toEqual({ clave: '31211508', nombre: 'Pinturas acrílicas' })
    expect(suggestions).toHaveLength(MAX_SAT_SUGGESTIONS)
    expect(new Set(suggestions.map((s) => s.clave)).size).toBe(suggestions.length)
    expect(rankSatSuggestions([], CATALOG)).toEqual([])
  })
})

describe('clave propuesta por categoria_sat', () => {
  test('solo si una sola sugerencia trae todas las palabras', () => {
    const terms = satSearchTerms('pinturas en aerosol')
    expect(proposedSatKey(terms, rankSatSuggestions(terms, CATALOG))).toBe('31211507')
    // "pinturas" alone matches three: the admin chooses.
    const one = satSearchTerms('pinturas')
    expect(proposedSatKey(one, rankSatSuggestions(one, CATALOG))).toBeNull()
    expect(proposedSatKey([], [])).toBeNull()
  })
})
