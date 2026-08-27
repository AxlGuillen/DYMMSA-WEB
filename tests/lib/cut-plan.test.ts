/**
 * Módulo de corte (issue #59) — matemática pura de src/lib/cut-plan.ts.
 * Cubre las esquinas físicas ANTES de que exista UI: ajuste a ras, el margen
 * que bloquea una pieza que "cabría" sin kerf, piezas imposibles, FFD.
 */

import { describe, test, expect } from 'vitest'
import {
  DEFAULT_CUT_MARGIN_MM,
  SETTING_CUT_MARGIN_MM,
  resolveCutMargin,
  formatMm,
  formatMm2,
  tubeNetNeeds,
  plateNetNeeds,
  packBars,
  packSheets,
  type TubePieceInput,
  type PlatePieceInput,
} from '@/lib/cut-plan'

const tube = (over: Partial<TubePieceInput> = {}): TubePieceInput => ({
  id: 'p1', diameterMm: 30, lengthMm: 300, quantity: 1, ...over,
})

const plate = (over: Partial<PlatePieceInput> = {}): PlatePieceInput => ({
  id: 'p1', thicknessMm: 5, widthMm: 100, lengthMm: 500, quantity: 1, ...over,
})

// ─── resolveCutMargin ────────────────────────────────────────────────────

describe('resolveCutMargin', () => {
  test('sin fila → default', () => {
    expect(resolveCutMargin({})).toBe(DEFAULT_CUT_MARGIN_MM)
  })

  test('valor válido gana; 0 es legítimo (estimar sin factor)', () => {
    expect(resolveCutMargin({ [SETTING_CUT_MARGIN_MM]: 15 })).toBe(15)
    expect(resolveCutMargin({ [SETTING_CUT_MARGIN_MM]: 0 })).toBe(0)
  })

  test('string numérico se coerce; basura y negativos caen al default', () => {
    expect(resolveCutMargin({ [SETTING_CUT_MARGIN_MM]: '25' })).toBe(25)
    expect(resolveCutMargin({ [SETTING_CUT_MARGIN_MM]: 'garbage' })).toBe(DEFAULT_CUT_MARGIN_MM)
    expect(resolveCutMargin({ [SETTING_CUT_MARGIN_MM]: -5 })).toBe(DEFAULT_CUT_MARGIN_MM)
    expect(resolveCutMargin({ [SETTING_CUT_MARGIN_MM]: NaN })).toBe(DEFAULT_CUT_MARGIN_MM)
  })
})

// ─── Formateo ────────────────────────────────────────────────────────────

describe('formatMm / formatMm2', () => {
  test('mm bajo el metro; metros con hasta 2 decimales sin ceros de cola', () => {
    expect(formatMm(300)).toBe('300 mm')
    expect(formatMm(999)).toBe('999 mm')
    expect(formatMm(1000)).toBe('1 m')
    expect(formatMm(6000)).toBe('6 m')
    expect(formatMm(2500)).toBe('2.5 m')
    expect(formatMm(1020)).toBe('1.02 m')
    expect(formatMm(12.7)).toBe('12.7 mm')
  })

  test('área en cm² bajo el m²; m² desde 1', () => {
    expect(formatMm2(60_000)).toBe('600 cm²')
    expect(formatMm2(1_000_000)).toBe('1 m²')
    expect(formatMm2(130_000)).toBe('1300 cm²')
    expect(formatMm2(2_340_000)).toBe('2.34 m²')
  })
})

// ─── Necesidad neta: tubos ───────────────────────────────────────────────

describe('tubeNetNeeds', () => {
  test('agrupa por diámetro (asc) y suma (longitud + margen) × cantidad', () => {
    const groups = tubeNetNeeds(
      [
        tube({ id: 'a', diameterMm: 30, lengthMm: 300, quantity: 4 }),
        tube({ id: 'b', diameterMm: 16, lengthMm: 250, quantity: 2 }),
        tube({ id: 'c', diameterMm: 30, lengthMm: 150, quantity: 1 }),
      ],
      20,
    )
    expect(groups.map((g) => g.diameterMm)).toEqual([16, 30])
    const d30 = groups[1]
    // (300+20)×4 + (150+20)×1 = 1280 + 170
    expect(d30.netLengthMm).toBe(1450)
    expect(d30.totalUnits).toBe(5)
    expect(d30.pieces).toHaveLength(2)
  })

  test('margen 0 = suma seca', () => {
    const [g] = tubeNetNeeds([tube({ lengthMm: 100, quantity: 3 })], 0)
    expect(g.netLengthMm).toBe(300)
  })
})

// ─── Necesidad neta: placas ──────────────────────────────────────────────

describe('plateNetNeeds', () => {
  test('agrupa por espesor con área total y ancho mínimo de tira', () => {
    const groups = plateNetNeeds([
      plate({ id: 'a', thicknessMm: 5, widthMm: 100, lengthMm: 500, quantity: 2 }),
      plate({ id: 'b', thicknessMm: 5, widthMm: 180, lengthMm: 200, quantity: 1 }),
      plate({ id: 'c', thicknessMm: 3, widthMm: 50, lengthMm: 50, quantity: 4 }),
    ])
    expect(groups.map((g) => g.thicknessMm)).toEqual([3, 5])
    const t5 = groups[1]
    expect(t5.areaMm2).toBe(100 * 500 * 2 + 180 * 200)
    // La pieza más ancha manda: la tira del proveedor debe medir al menos esto.
    expect(t5.minWidthMm).toBe(180)
    expect(t5.totalUnits).toBe(3)
  })
})

// ─── Acomodo de barras (tubos) ───────────────────────────────────────────

describe('packBars', () => {
  test('ajuste a ras sin margen: 3×1000 en barra de 3000, sobrante 0', () => {
    const { bars, impossible } = packBars([{ id: 'a', lengthMm: 1000, quantity: 3 }], 3000, 0)
    expect(impossible).toHaveLength(0)
    expect(bars).toHaveLength(1)
    expect(bars[0].segments).toHaveLength(3)
    expect(bars[0].leftoverMm).toBe(0)
  })

  test('el margen BLOQUEA la pieza que cabría sin kerf (2×1000 en 2000, margen 20)', () => {
    // Sin margen cabrían las dos; el corte entre ellas se come 20 mm → 2 barras.
    const { bars } = packBars([{ id: 'a', lengthMm: 1000, quantity: 2 }], 2000, 20)
    expect(bars).toHaveLength(2)
  })

  test('la ÚLTIMA pieza puede caer exacta al final (su margen no se exige al entrar)', () => {
    // [1000][20][980] = 2000 exactos → una sola barra, sobrante 0 (clamp).
    const { bars } = packBars(
      [
        { id: 'a', lengthMm: 1000, quantity: 1 },
        { id: 'b', lengthMm: 980, quantity: 1 },
      ],
      2000,
      20,
    )
    expect(bars).toHaveLength(1)
    expect(bars[0].leftoverMm).toBe(0)
  })

  test('FFD: de mayor a menor, primera barra donde quepa', () => {
    const { bars } = packBars(
      [
        { id: 'chica', lengthMm: 400, quantity: 1 },
        { id: 'grande', lengthMm: 600, quantity: 1 },
        { id: 'media', lengthMm: 500, quantity: 1 },
      ],
      1000,
      0,
    )
    // Orden 600, 500, 400: [600|400] y [500].
    expect(bars).toHaveLength(2)
    expect(bars[0].segments.map((s) => s.pieceId)).toEqual(['grande', 'chica'])
    expect(bars[1].segments.map((s) => s.pieceId)).toEqual(['media'])
  })

  test('sobrante descuenta un margen por segmento', () => {
    const { bars } = packBars([{ id: 'a', lengthMm: 1000, quantity: 1 }], 3000, 20)
    // [1000][corte 20] → usado 1020, sobrante 1980.
    expect(bars[0].usedMm).toBe(1020)
    expect(bars[0].leftoverMm).toBe(1980)
  })

  test('pieza más larga que la barra → imposible, no se acomoda', () => {
    const { bars, impossible } = packBars(
      [
        { id: 'ok', lengthMm: 500, quantity: 1 },
        { id: 'gigante', lengthMm: 7000, quantity: 2 },
      ],
      6000,
      20,
    )
    expect(impossible).toEqual([{ pieceId: 'gigante', lengthMm: 7000, quantity: 2 }])
    const packed = bars.flatMap((b) => b.segments.map((s) => s.pieceId))
    expect(packed).toEqual(['ok'])
  })

  test('la cantidad expande a unidades físicas repartidas en barras', () => {
    const { bars } = packBars([{ id: 'a', lengthMm: 2500, quantity: 5 }], 6000, 0)
    // 2 por barra (5000 ≤ 6000; 3ª no cabe: 7500) → 3 barras: 2+2+1.
    expect(bars.map((b) => b.segments.length)).toEqual([2, 2, 1])
  })

  test('sin piezas → sin barras', () => {
    expect(packBars([], 6000, 20)).toEqual({ bars: [], impossible: [] })
  })
})

// ─── Acomodo en hojas de medida fija (placas, issue #64) ─────────────────

describe('packSheets', () => {
  test('piezas del mismo ancho que no caben a lo largo van en carriles apilados', () => {
    const { sheets } = packSheets(
      [{ id: 'a', widthMm: 80, lengthMm: 500, quantity: 2 }],
      200,
      600,
      10,
    )
    // 500 + 10 + 500 > 600 (no caben punta con punta) pero 80 + 10 + 80 = 170 ≤ 200.
    expect(sheets).toHaveLength(1)
    expect(sheets[0].lanes.map((l) => l.yMm)).toEqual([0, 90])
    expect(sheets[0].usedLengthMm).toBe(500)
    expect(sheets[0].usedWidthMm).toBe(170)
  })

  test('dentro de un carril las piezas van punta con punta, con margen entre cortes', () => {
    const { sheets } = packSheets(
      [{ id: 'a', widthMm: 80, lengthMm: 400, quantity: 2 }],
      100,
      1000,
      10,
    )
    expect(sheets).toHaveLength(1)
    expect(sheets[0].lanes).toHaveLength(1)
    expect(sheets[0].lanes[0].items.map((i) => i.xMm)).toEqual([0, 410])
    expect(sheets[0].usedLengthMm).toBe(810)
  })

  test('REGRESIÓN #81: el caso reportado cabe en UNA hoja (antes pedía dos)', () => {
    // Hoja 150 × 420, margen 20: la 30×400 en su carril y las dos 100×200
    // punta con punta (200+20+200 = 420 exacto). El modelo shelf mandaba la
    // segunda 100×200 a una hoja nueva.
    const { sheets, impossible } = packSheets(
      [
        { id: 'angosta', widthMm: 30, lengthMm: 400, quantity: 1 },
        { id: 'media', widthMm: 100, lengthMm: 200, quantity: 2 },
      ],
      150,
      420,
      20,
    )
    expect(impossible).toEqual([])
    expect(sheets).toHaveLength(1)
    // FFD por ancho: el carril de 100 va primero (y=0), el de 30 después.
    const [wide, narrow] = sheets[0].lanes
    expect(wide.widthMm).toBe(100)
    expect(wide.items.map((i) => i.xMm)).toEqual([0, 220])
    expect(narrow.widthMm).toBe(30)
    expect(narrow.yMm).toBe(120)
    expect(sheets[0].usedWidthMm).toBe(150)
    expect(sheets[0].usedLengthMm).toBe(420)
  })

  test('cuando ni largo ni ancho alcanzan, la pieza abre hoja nueva', () => {
    const { sheets } = packSheets(
      [
        { id: 'larga', widthMm: 150, lengthMm: 500, quantity: 1 },
        { id: 'corta', widthMm: 150, lengthMm: 300, quantity: 1 },
      ],
      200,
      600,
      10,
    )
    // En carril: 500 + 10 + 300 > 600; carril nuevo: 150 + 10 + 150 > 200 → hoja 2.
    expect(sheets).toHaveLength(2)
    expect(sheets[0].lanes[0].usedLengthMm).toBe(500)
    expect(sheets[1].lanes[0].usedLengthMm).toBe(300)
  })

  test('una pieza angosta rellena el largo restante del carril ancho', () => {
    const { sheets } = packSheets(
      [
        { id: 'ancha', widthMm: 100, lengthMm: 500, quantity: 1 },
        { id: 'angosta', widthMm: 40, lengthMm: 300, quantity: 1 },
      ],
      120,
      1000,
      10,
    )
    // La de 40 cabe DENTRO del carril de 100 (ancho 40 ≤ 100) tras la de 500.
    expect(sheets).toHaveLength(1)
    expect(sheets[0].lanes).toHaveLength(1)
    expect(sheets[0].lanes[0].items.map((i) => i.xMm)).toEqual([0, 510])
  })

  test('pieza más ancha O más larga que la hoja → imposible (v1 no rota)', () => {
    const { sheets, impossible } = packSheets(
      [
        { id: 'ancha', widthMm: 300, lengthMm: 100, quantity: 1 },
        { id: 'muy-larga', widthMm: 100, lengthMm: 900, quantity: 1 },
      ],
      200,
      600,
      10,
    )
    expect(sheets).toHaveLength(0)
    expect(impossible).toEqual([
      { pieceId: 'ancha', lengthMm: 100, quantity: 1 },
      { pieceId: 'muy-larga', lengthMm: 900, quantity: 1 },
    ])
  })

  test('sin piezas → sin hojas', () => {
    expect(packSheets([], 200, 600, 10)).toEqual({ sheets: [], impossible: [] })
  })
})
