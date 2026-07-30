/**
 * Módulo de corte de material (issue #59) — matemática pura, sin UI.
 *
 * Productos DYMMSA que se mandan a hacer cortando tubo o placa de cobre.
 * El problema vive en dos momentos:
 *
 *  1. NECESIDAD NETA — antes de hablar con el proveedor no se conocen sus
 *     presentaciones, pero sí se le puede decir "necesito 14 m de Ø30":
 *     Σ (longitud + margen) × cantidad, agrupado por medida.
 *  2. ACOMODO — cuando el proveedor responde "tengo barras de 6 m", se calcula
 *     el patrón real: cuántas barras, cómo partir cada una y cuánto sobra.
 *
 * Convenciones:
 *  - Unidades SIEMPRE en mm. Los `numeric` de Postgres llegan como string por
 *    supabase-js: el caller (API/hooks) los coerce a number ANTES de llamar aquí.
 *  - El margen de corte (kerf) se come material en CADA partición. En la
 *    necesidad neta se cobra por pieza (sobreestima ligera y a propósito: es
 *    una cifra para PEDIR, el acomodo real la afina).
 *  - Placas v1 SIN rotación de piezas (si hiciera falta girar 90°, es mejora
 *    futura — puede haber veta/acabado que respetar).
 */

// ─── Margen de corte (ajuste) ──────────────────────────────────────────

/** Margen que consume cada partición (el "1 o 2 cm" del taller). */
export const DEFAULT_CUT_MARGIN_MM = 20
export const SETTING_CUT_MARGIN_MM = 'cut_margin_mm'

/**
 * Margen desde `app_settings` con fallback al default. Acepta 0 (estimar sin
 * factor es legítimo); negativos o no-números caen al default — la config
 * nunca rompe el cálculo (mismo criterio que `resolveThresholds`).
 */
export function resolveCutMargin(settings: Record<string, unknown>): number {
  const raw = settings[SETTING_CUT_MARGIN_MM]
  const value = typeof raw === 'number' ? raw : Number(raw)
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_CUT_MARGIN_MM
}

// ─── Entradas ──────────────────────────────────────────────────────────

export interface TubePieceInput {
  id: string
  diameterMm: number
  lengthMm: number
  quantity: number
}

export interface PlatePieceInput {
  id: string
  thicknessMm: number
  /** Ancho de la PIEZA (el de la tira lo pone la presentación del proveedor). */
  widthMm: number
  lengthMm: number
  quantity: number
}

// ─── Momento 1: necesidad neta ─────────────────────────────────────────

export interface TubeNeedGroup {
  diameterMm: number
  pieces: TubePieceInput[]
  totalUnits: number
  /** Σ (longitud + margen) × cantidad — lo que se le pide al proveedor. */
  netLengthMm: number
}

/** Agrupa por diámetro (orden ascendente) y suma la necesidad con margen. */
export function tubeNetNeeds(pieces: readonly TubePieceInput[], marginMm: number): TubeNeedGroup[] {
  const groups = new Map<number, TubeNeedGroup>()
  for (const piece of pieces) {
    let group = groups.get(piece.diameterMm)
    if (!group) {
      group = { diameterMm: piece.diameterMm, pieces: [], totalUnits: 0, netLengthMm: 0 }
      groups.set(piece.diameterMm, group)
    }
    group.pieces.push(piece)
    group.totalUnits += piece.quantity
    group.netLengthMm += (piece.lengthMm + marginMm) * piece.quantity
  }
  return [...groups.values()].sort((a, b) => a.diameterMm - b.diameterMm)
}

export interface PlateNeedGroup {
  thicknessMm: number
  pieces: PlatePieceInput[]
  totalUnits: number
  /** Área total pedida (sin margen — referencia, no cifra de compra). */
  areaMm2: number
  /** Ancho mínimo que debe tener la tira del proveedor (la pieza más ancha). */
  minWidthMm: number
}

/**
 * Necesidad por espesor. En placas no hay "metros a pedir" hasta conocer el
 * ancho de la tira; lo útil antes del proveedor es el área y el ancho mínimo
 * que su material debe tener.
 */
export function plateNetNeeds(pieces: readonly PlatePieceInput[]): PlateNeedGroup[] {
  const groups = new Map<number, PlateNeedGroup>()
  for (const piece of pieces) {
    let group = groups.get(piece.thicknessMm)
    if (!group) {
      group = { thicknessMm: piece.thicknessMm, pieces: [], totalUnits: 0, areaMm2: 0, minWidthMm: 0 }
      groups.set(piece.thicknessMm, group)
    }
    group.pieces.push(piece)
    group.totalUnits += piece.quantity
    group.areaMm2 += piece.widthMm * piece.lengthMm * piece.quantity
    group.minWidthMm = Math.max(group.minWidthMm, piece.widthMm)
  }
  return [...groups.values()].sort((a, b) => a.thicknessMm - b.thicknessMm)
}

// ─── Momento 2: acomodo de barras (tubos, 1D) ──────────────────────────

export interface PackedSegment {
  pieceId: string
  lengthMm: number
}

export interface PackedBar {
  segments: PackedSegment[]
  /** Material consumido: piezas + un margen por partición (clamp al largo). */
  usedMm: number
  leftoverMm: number
}

/** Pieza que no cabe NI SOLA en la presentación elegida. */
export interface ImpossiblePiece {
  pieceId: string
  lengthMm: number
  quantity: number
}

export interface BarPackResult {
  bars: PackedBar[]
  impossible: ImpossiblePiece[]
}

/**
 * Acomodo first-fit decreasing: unidades de mayor a menor, cada una a la
 * primera barra donde quepa; si ninguna, se abre barra nueva.
 *
 * Modelo físico del margen: la barra queda [p1][corte][p2][corte]…[sobrante].
 * Una pieza cabe si Σ colocadas + margen × cortes existentes + pieza ≤ barra —
 * la partición de la ÚLTIMA pieza puede caer exacta al final (ajuste a ras),
 * por eso su margen no se exige al entrar. El sobrante mostrado sí descuenta
 * un margen por segmento (clamp en 0): si hay resto, hace falta ese corte.
 */
export function packBars(
  pieces: readonly { id: string; lengthMm: number; quantity: number }[],
  barLengthMm: number,
  marginMm: number,
): BarPackResult {
  const impossible: ImpossiblePiece[] = pieces
    .filter((piece) => piece.lengthMm > barLengthMm)
    .map((piece) => ({ pieceId: piece.id, lengthMm: piece.lengthMm, quantity: piece.quantity }))

  // Expandir a unidades físicas y ordenar de mayor a menor (FFD).
  const units = pieces
    .filter((piece) => piece.lengthMm <= barLengthMm)
    .flatMap((piece) =>
      Array.from({ length: piece.quantity }, () => ({ pieceId: piece.id, lengthMm: piece.lengthMm })),
    )
    .sort((a, b) => b.lengthMm - a.lengthMm)

  const bars: { segments: PackedSegment[]; sumMm: number }[] = []

  for (const unit of units) {
    const target = bars.find(
      (bar) => bar.sumMm + marginMm * bar.segments.length + unit.lengthMm <= barLengthMm,
    )
    if (target) {
      target.segments.push(unit)
      target.sumMm += unit.lengthMm
    } else {
      bars.push({ segments: [unit], sumMm: unit.lengthMm })
    }
  }

  return {
    bars: bars.map((bar) => {
      const usedMm = Math.min(barLengthMm, bar.sumMm + marginMm * bar.segments.length)
      return { segments: bar.segments, usedMm, leftoverMm: barLengthMm - usedMm }
    }),
    impossible,
  }
}

// ─── Momento 2: acomodo en tira (placas, shelf packing) ────────────────

export interface PackedPlateItem {
  pieceId: string
  widthMm: number
  lengthMm: number
  /** Posición a lo ancho de la tira (para dibujar). */
  offsetMm: number
}

export interface PackedShelf {
  /** Largo de tira que consume la fila (la pieza más larga la define). */
  lengthMm: number
  items: PackedPlateItem[]
  usedWidthMm: number
}

export interface StripPackResult {
  shelves: PackedShelf[]
  /** Largo total de tira a pedir: filas + un margen entre cada par de filas. */
  totalLengthMm: number
  /** Piezas más anchas que la tira (v1 no rota — podría haber veta que respetar). */
  impossible: ImpossiblePiece[]
}

/**
 * Acomodo por filas (shelf, first-fit decreasing por LARGO): la primera pieza
 * de cada fila —la más larga— define cuánto largo de tira consume la fila, y
 * las siguientes se acomodan a lo ancho mientras quepan (margen entre piezas).
 * Como las unidades van de mayor a menor, ninguna pieza excede el largo de la
 * fila donde entra.
 */
export function packStrip(
  pieces: readonly { id: string; widthMm: number; lengthMm: number; quantity: number }[],
  stripWidthMm: number,
  marginMm: number,
): StripPackResult {
  const impossible: ImpossiblePiece[] = pieces
    .filter((piece) => piece.widthMm > stripWidthMm)
    .map((piece) => ({ pieceId: piece.id, lengthMm: piece.lengthMm, quantity: piece.quantity }))

  const units = pieces
    .filter((piece) => piece.widthMm <= stripWidthMm)
    .flatMap((piece) =>
      Array.from({ length: piece.quantity }, () => ({
        pieceId: piece.id,
        widthMm: piece.widthMm,
        lengthMm: piece.lengthMm,
      })),
    )
    .sort((a, b) => b.lengthMm - a.lengthMm)

  const shelves: PackedShelf[] = []

  for (const unit of units) {
    const target = shelves.find(
      (shelf) => shelf.usedWidthMm + marginMm + unit.widthMm <= stripWidthMm,
    )
    if (target) {
      target.items.push({ ...unit, offsetMm: target.usedWidthMm + marginMm })
      target.usedWidthMm += marginMm + unit.widthMm
    } else {
      shelves.push({
        lengthMm: unit.lengthMm,
        items: [{ ...unit, offsetMm: 0 }],
        usedWidthMm: unit.widthMm,
      })
    }
  }

  const totalLengthMm =
    shelves.reduce((sum, shelf) => sum + shelf.lengthMm, 0) +
    marginMm * Math.max(0, shelves.length - 1)

  return { shelves, totalLengthMm, impossible }
}
