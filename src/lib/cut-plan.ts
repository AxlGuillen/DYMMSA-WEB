/**
 * Módulo de corte — matemática pura en mm (ADR-022): momento 1 = necesidad
 * neta para pedir; momento 2 = acomodo en barras/hojas del proveedor.
 * El caller coerce los numeric-string de supabase-js ANTES de llamar aquí.
 */

// ─── Margen de corte (ajuste) ──────────────────────────────────────────

/** Margen que consume cada partición (el "1 o 2 cm" del taller). */
export const DEFAULT_CUT_MARGIN_MM = 20
export const SETTING_CUT_MARGIN_MM = 'cut_margin_mm'

/** Margen desde settings; 0 es válido, inválidos caen al default — la config nunca rompe el cálculo. */
export function resolveCutMargin(settings: Record<string, unknown>): number {
  const raw = settings[SETTING_CUT_MARGIN_MM]
  const value = typeof raw === 'number' ? raw : Number(raw)
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_CUT_MARGIN_MM
}

/**
 * mm legibles: bajo el metro se queda en mm ("300 mm"); desde 1 m usa metros
 * con hasta 2 decimales sin ceros de cola ("6 m", "2.5 m", "1.02 m").
 */
export function formatMm(mm: number): string {
  if (mm < 1000) return `${Math.round(mm * 10) / 10} mm`
  const meters = Math.round((mm / 1000) * 100) / 100
  return `${meters} m`
}

/** mm² legibles: bajo el m² usa cm² ("600 cm²"); desde 1 m² usa m². */
export function formatMm2(mm2: number): string {
  if (mm2 < 1_000_000) return `${Math.round(mm2 / 100)} cm²`
  return `${Math.round((mm2 / 1_000_000) * 100) / 100} m²`
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

/** Necesidad por espesor: antes del proveedor lo útil es área + ancho mínimo, no metros. */
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
 * First-fit decreasing en barras. Modelo del margen: [p][corte][p]…[sobrante];
 * la última partición puede caer a ras, por eso su margen no se exige al entrar.
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

export interface PackedSheet {
  shelves: PackedShelf[]
  /** Largo de hoja consumido: filas + un margen entre cada par de filas. */
  usedLengthMm: number
}

export interface SheetPackResult {
  sheets: PackedSheet[]
  /** Piezas más anchas O más largas que la hoja (v1 no rota — puede haber veta). */
  impossible: ImpossiblePiece[]
}

/**
 * Acomodo en HOJAS de medida fija (#64): filas shelf-FFD por largo, luego las
 * filas se paginan en hojas con margen entre pares — la más larga define cada fila.
 */
export function packSheets(
  pieces: readonly { id: string; widthMm: number; lengthMm: number; quantity: number }[],
  sheetWidthMm: number,
  sheetLengthMm: number,
  marginMm: number,
): SheetPackResult {
  const impossible: ImpossiblePiece[] = pieces
    .filter((piece) => piece.widthMm > sheetWidthMm || piece.lengthMm > sheetLengthMm)
    .map((piece) => ({ pieceId: piece.id, lengthMm: piece.lengthMm, quantity: piece.quantity }))

  const units = pieces
    .filter((piece) => piece.widthMm <= sheetWidthMm && piece.lengthMm <= sheetLengthMm)
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
      (shelf) => shelf.usedWidthMm + marginMm + unit.widthMm <= sheetWidthMm,
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

  const sheets: PackedSheet[] = []
  for (const shelf of shelves) {
    const target = sheets.find(
      (sheet) => sheet.usedLengthMm + marginMm + shelf.lengthMm <= sheetLengthMm,
    )
    if (target) {
      target.shelves.push(shelf)
      target.usedLengthMm += marginMm + shelf.lengthMm
    } else {
      sheets.push({ shelves: [shelf], usedLengthMm: shelf.lengthMm })
    }
  }

  return { sheets, impossible }
}
