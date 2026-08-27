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

// ─── Momento 2: acomodo en hojas (placas, carriles por ancho) ──────────

export interface PackedPlateItem {
  pieceId: string
  widthMm: number
  lengthMm: number
  /** true si la pieza se colocó girada 90° (ancho↔largo invertidos). */
  rotated: boolean
  /** Posición a lo LARGO de la hoja (X, para dibujar). */
  xMm: number
  /** Posición a lo ANCHO de la hoja (Y = offset del carril). */
  yMm: number
}

/** Banda a lo ancho de la hoja; las piezas corren a lo largo, punta con punta. */
export interface PackedLane {
  /** Ancho del carril (la pieza más ancha lo define). */
  widthMm: number
  /** Offset del carril a lo ancho de la hoja. */
  yMm: number
  /** Largo consumido: piezas + margen entre cada par. */
  usedLengthMm: number
  items: PackedPlateItem[]
}

export interface PackedSheet {
  lanes: PackedLane[]
  /** Ancho consumido: carriles + margen entre cada par. */
  usedWidthMm: number
  /** Máximo largo consumido entre carriles (para el sobrante global). */
  usedLengthMm: number
}

export interface SheetPackResult {
  sheets: PackedSheet[]
  /** Piezas que no caben en NINGUNA orientación permitida. */
  impossible: ImpossiblePiece[]
}

/** Orientación colocable de una unidad (la rotada invierte ancho↔largo). */
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
  // La cuadrada no duplica; la rotada solo si cabe girada.
  if (allowRotation && widthMm !== lengthMm && lengthMm <= sheetWidthMm && widthMm <= sheetLengthMm) {
    out.push({ widthMm: lengthMm, lengthMm: widthMm, rotated: true })
  }
  return out
}

/**
 * Acomodo en HOJAS por CARRILES (#81): FFD por ancho; dentro del carril las
 * piezas van punta con punta a lo largo. Con `allowRotation` cada pieza puede
 * girarse 90° si así cabe (desactivable cuando la veta/acabado manda).
 */
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

  // Orientación "preferida" = la más angosta (conserva ancho de hoja); las
  // unidades se ordenan por ese ancho desc — las difíciles definen carriles.
  const preferred = (u: { orientations: Orientation[] }) =>
    [...u.orientations].sort((a, b) => a.widthMm - b.widthMm || a.lengthMm - b.lengthMm)[0]
  units.sort((a, b) => {
    const pa = preferred(a), pb = preferred(b)
    return pb.widthMm - pa.widthMm || pb.lengthMm - pa.lengthMm
  })

  const sheets: PackedSheet[] = []
  for (const unit of units) {
    // 1) Carril existente (first-fit sobre todas las hojas): dentro del carril
    //    gana la orientación de MENOR largo — conserva largo del carril.
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

    // 2) Carril nuevo en hoja abierta: gana la orientación más ANGOSTA que quepa.
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

    // 3) Hoja nueva con la orientación preferida (la más angosta).
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
