/** Pure mm math (ADR-022). Callers coerce supabase-js numeric strings first. */

/** Margin consumed by every cut. */
export const DEFAULT_CUT_MARGIN_MM = 20
export const SETTING_CUT_MARGIN_MM = 'cut_margin_mm'

/** 0 is valid; invalid values fall back to the default so config never breaks the math. */
export function resolveCutMargin(settings: Record<string, unknown>): number {
  const raw = settings[SETTING_CUT_MARGIN_MM]
  const value = typeof raw === 'number' ? raw : Number(raw)
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_CUT_MARGIN_MM
}

/** Readable mm: below 1 m stays in mm, from 1 m switches to metres. */
export function formatMm(mm: number): string {
  if (mm < 1000) return `${Math.round(mm * 10) / 10} mm`
  const meters = Math.round((mm / 1000) * 100) / 100
  return `${meters} m`
}

/** Readable mm²: below 1 m² uses cm². */
export function formatMm2(mm2: number): string {
  if (mm2 < 1_000_000) return `${Math.round(mm2 / 100)} cm²`
  return `${Math.round((mm2 / 1_000_000) * 100) / 100} m²`
}

export interface TubePieceInput {
  id: string
  diameterMm: number
  lengthMm: number
  quantity: number
}

export interface PlatePieceInput {
  id: string
  thicknessMm: number
  /** Width of the PIECE; the stock width comes from the supplier presentation. */
  widthMm: number
  lengthMm: number
  quantity: number
}

export interface TubeNeedGroup {
  diameterMm: number
  pieces: TubePieceInput[]
  totalUnits: number
  /** Σ (length + margin) × quantity — the figure to order. */
  netLengthMm: number
}

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
  /** Total area, no margin — reference only, not a purchase figure. */
  areaMm2: number
  /** Minimum supplier stock width: the widest piece. */
  minWidthMm: number
}

/** Per thickness: before picking a supplier what matters is area + min width, not metres. */
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

export interface PackedSegment {
  pieceId: string
  lengthMm: number
}

export interface PackedBar {
  segments: PackedSegment[]
  /** Pieces + one margin per cut, clamped to the bar length. */
  usedMm: number
  leftoverMm: number
}

/** Piece that does not fit even alone in the chosen presentation. */
export interface ImpossiblePiece {
  pieceId: string
  lengthMm: number
  quantity: number
}

export interface BarPackResult {
  bars: PackedBar[]
  impossible: ImpossiblePiece[]
}

/** First-fit decreasing. Margin model [p][cut][p]…[leftover]: the last cut may end flush, so its
 *  margin is not required on entry. */
export function packBars(
  pieces: readonly { id: string; lengthMm: number; quantity: number }[],
  barLengthMm: number,
  marginMm: number,
): BarPackResult {
  const impossible: ImpossiblePiece[] = pieces
    .filter((piece) => piece.lengthMm > barLengthMm)
    .map((piece) => ({ pieceId: piece.id, lengthMm: piece.lengthMm, quantity: piece.quantity }))

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

export interface PackedPlateItem {
  pieceId: string
  widthMm: number
  lengthMm: number
  /** true when placed rotated 90°. */
  rotated: boolean
  /** Position along the sheet length (X). */
  xMm: number
  /** Position across the sheet width (Y = lane offset). */
  yMm: number
}

/** Band across the sheet width; pieces run end to end along the length. */
export interface PackedLane {
  /** Lane width, set by its widest piece. */
  widthMm: number
  /** Lane offset across the sheet width. */
  yMm: number
  /** Length used: pieces + margin between each pair. */
  usedLengthMm: number
  items: PackedPlateItem[]
}

export interface PackedSheet {
  lanes: PackedLane[]
  /** Width used: lanes + margin between each pair. */
  usedWidthMm: number
  /** Longest lane, for the global leftover. */
  usedLengthMm: number
}

export interface SheetPackResult {
  sheets: PackedSheet[]
  /** Pieces that fit in NO allowed orientation. */
  impossible: ImpossiblePiece[]
}

/** Placeable orientation; the rotated one swaps width and length. */
interface Orientation {
  widthMm: number
  lengthMm: number
  rotated: boolean
}

function orientationsFor(
  widthMm: number,
  lengthMm: number,
  sheetWidthMm: number,
  sheetLengthMm: number,
  allowRotation: boolean,
): Orientation[] {
  const out: Orientation[] = []
  if (widthMm <= sheetWidthMm && lengthMm <= sheetLengthMm) {
    out.push({ widthMm, lengthMm, rotated: false })
  }
  // A square piece must not duplicate; rotate only when it fits rotated.
  if (allowRotation && widthMm !== lengthMm && lengthMm <= sheetWidthMm && widthMm <= sheetLengthMm) {
    out.push({ widthMm: lengthMm, lengthMm: widthMm, rotated: true })
  }
  return out
}

/** Sheet packing by LANES (#81): FFD by width, pieces end to end inside a lane. `allowRotation` is
 *  off when grain/finish dictates the orientation. */
export function packSheets(
  pieces: readonly { id: string; widthMm: number; lengthMm: number; quantity: number }[],
  sheetWidthMm: number,
  sheetLengthMm: number,
  marginMm: number,
  options: { allowRotation?: boolean } = {},
): SheetPackResult {
  const allowRotation = options.allowRotation ?? false

  const impossible: ImpossiblePiece[] = []
  const units: { pieceId: string; orientations: Orientation[] }[] = []
  for (const piece of pieces) {
    const orientations = orientationsFor(
      piece.widthMm, piece.lengthMm, sheetWidthMm, sheetLengthMm, allowRotation,
    )
    if (orientations.length === 0) {
      impossible.push({ pieceId: piece.id, lengthMm: piece.lengthMm, quantity: piece.quantity })
      continue
    }
    for (let i = 0; i < piece.quantity; i++) units.push({ pieceId: piece.id, orientations })
  }

  // Preferred orientation = narrowest (saves sheet width); units sort by it
  // descending so the hardest ones define the lanes.
  const preferred = (u: { orientations: Orientation[] }) =>
    [...u.orientations].sort((a, b) => a.widthMm - b.widthMm || a.lengthMm - b.lengthMm)[0]
  units.sort((a, b) => {
    const pa = preferred(a), pb = preferred(b)
    return pb.widthMm - pa.widthMm || pb.lengthMm - pa.lengthMm
  })

  const sheets: PackedSheet[] = []
  for (const unit of units) {
    // 1) Existing lane (first-fit across sheets): shortest orientation wins, saving lane length.
    let placed = false
    for (const sheet of sheets) {
      for (const lane of sheet.lanes) {
        const fit = unit.orientations
          .filter((o) => o.widthMm <= lane.widthMm && lane.usedLengthMm + marginMm + o.lengthMm <= sheetLengthMm)
          .sort((a, b) => a.lengthMm - b.lengthMm)[0]
        if (fit) {
          const xMm = lane.usedLengthMm + marginMm
          lane.items.push({ pieceId: unit.pieceId, widthMm: fit.widthMm, lengthMm: fit.lengthMm, rotated: fit.rotated, xMm, yMm: lane.yMm })
          lane.usedLengthMm = xMm + fit.lengthMm
          sheet.usedLengthMm = Math.max(sheet.usedLengthMm, lane.usedLengthMm)
          placed = true
          break
        }
      }
      if (placed) break
    }
    if (placed) continue

    // 2) New lane on an open sheet: narrowest fitting orientation wins.
    const byWidth = [...unit.orientations].sort((a, b) => a.widthMm - b.widthMm)
    for (const o of byWidth) {
      const sheet = sheets.find((s) => s.usedWidthMm + marginMm + o.widthMm <= sheetWidthMm)
      if (sheet) {
        const yMm = sheet.usedWidthMm + marginMm
        sheet.lanes.push({
          widthMm: o.widthMm,
          yMm,
          usedLengthMm: o.lengthMm,
          items: [{ pieceId: unit.pieceId, widthMm: o.widthMm, lengthMm: o.lengthMm, rotated: o.rotated, xMm: 0, yMm }],
        })
        sheet.usedWidthMm = yMm + o.widthMm
        sheet.usedLengthMm = Math.max(sheet.usedLengthMm, o.lengthMm)
        placed = true
        break
      }
    }
    if (placed) continue

    // 3) New sheet with the preferred (narrowest) orientation.
    const o = byWidth[0]
    sheets.push({
      lanes: [{
        widthMm: o.widthMm,
        yMm: 0,
        usedLengthMm: o.lengthMm,
        items: [{ pieceId: unit.pieceId, widthMm: o.widthMm, lengthMm: o.lengthMm, rotated: o.rotated, xMm: 0, yMm: 0 }],
      }],
      usedWidthMm: o.widthMm,
      usedLengthMm: o.lengthMm,
    })
  }

  return { sheets, impossible }
}
