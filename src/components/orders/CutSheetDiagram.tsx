'use client'

import { useId } from 'react'
import { formatMm } from '@/lib/cut-plan'
import type { PackedSheet } from '@/lib/cut-plan'

interface CutSheetDiagramProps {
  sheetWidthMm: number
  sheetLengthMm: number
  marginMm: number
  sheet: PackedSheet
}

const VIEW_W = 1000
const VIEW_H = 140

/** Posiciones X acumuladas de cada fila (fuera del render por el compilador de React). */
function layoutShelves(sheet: PackedSheet, marginMm: number, scaleX: number) {
  const out: (PackedSheet['shelves'][number] & { x: number })[] = []
  let cursorMm = 0
  for (const shelf of sheet.shelves) {
    out.push({ ...shelf, x: cursorMm * scaleX })
    cursorMm += shelf.lengthMm + marginMm
  }
  return out
}

/**
 * Una HOJA de placa de medida fija vista desde arriba (issue #64): el largo de
 * la hoja corre en X, el ancho en Y — el lienzo es la hoja completa que vende
 * el proveedor, y el sobrante queda punteado como en el diagrama de barras.
 * Cada fila (shelf) consume el largo de su pieza más larga; los cortes entre
 * filas van en oscuro. SVG imprimible para el taller.
 */
export function CutSheetDiagram({ sheetWidthMm, sheetLengthMm, marginMm, sheet }: CutSheetDiagramProps) {
  const kerfPatternId = useId()
  if (sheetLengthMm <= 0 || sheetWidthMm <= 0) return null
  const scaleX = VIEW_W / sheetLengthMm
  const scaleY = VIEW_H / sheetWidthMm
  const positioned = layoutShelves(sheet, marginMm, scaleX)
  const usedX = Math.min(VIEW_W, sheet.usedLengthMm * scaleX)

  const pieces = sheet.shelves.reduce((n, s) => n + s.items.length, 0)
  const usedArea = sheet.shelves.reduce(
    (sum, shelf) => sum + shelf.items.reduce((s, i) => s + i.widthMm * i.lengthMm, 0),
    0,
  )
  const utilization = Math.round((usedArea / (sheetLengthMm * sheetWidthMm)) * 100)

  return (
    <div className="space-y-1">
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        className="w-full rounded border border-border"
        role="img"
        aria-label={`Hoja de ${formatMm(sheetLengthMm)} × ${formatMm(sheetWidthMm)} con ${pieces} piezas`}
      >
        <defs>
          {/* Achurado del paso de la sierra (issue #71), como en las barras. */}
          <pattern id={kerfPatternId} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="6" height="6" className="fill-foreground/40" />
            <line x1="0" y1="0" x2="0" y2="6" className="stroke-background" strokeWidth="2.5" />
          </pattern>
        </defs>
        <rect x="0" y="0" width={VIEW_W} height={VIEW_H} className="fill-muted" />
        {positioned.map((shelf, shelfIndex) => (
          <g key={shelfIndex}>
            {shelf.items.map((item, itemIndex) => {
              const w = item.lengthMm * scaleX
              const h = item.widthMm * scaleY
              return (
                <g key={`${item.pieceId}-${itemIndex}`}>
                  <rect
                    x={shelf.x}
                    y={item.offsetMm * scaleY}
                    width={Math.max(1, w - 2)}
                    height={Math.max(1, h - 2)}
                    rx={3}
                    className="fill-amber-600/80 stroke-amber-800/60 dark:fill-amber-500/70"
                  >
                    <title>{`${formatMm(item.widthMm)} × ${formatMm(item.lengthMm)}`}</title>
                  </rect>
                  {w > 90 && h > 22 && (
                    <text
                      x={shelf.x + w / 2}
                      y={item.offsetMm * scaleY + h / 2 + 4}
                      textAnchor="middle"
                      className="fill-white text-[12px] font-medium"
                    >
                      {item.widthMm}×{item.lengthMm}
                    </text>
                  )}
                </g>
              )
            })}
            {/* Corte entre filas: achurado = aquí pasa la sierra */}
            {marginMm > 0 && shelfIndex < positioned.length - 1 && (
              <rect
                x={shelf.x + shelf.lengthMm * scaleX}
                y={0}
                width={Math.max(2.5, marginMm * scaleX)}
                height={VIEW_H}
                fill={`url(#${kerfPatternId})`}
              >
                <title>{`Corte de sierra: ${formatMm(marginMm)}`}</title>
              </rect>
            )}
          </g>
        ))}
        {/* Sobrante de la hoja (punteado), con su medida cuando cabe el texto */}
        {usedX < VIEW_W - 2 && (
          <g>
            <rect
              x={usedX + 2}
              y={2}
              width={VIEW_W - usedX - 4}
              height={VIEW_H - 4}
              rx={3}
              className="fill-transparent stroke-muted-foreground/50 [stroke-dasharray:6_5]"
            />
            {VIEW_W - usedX > 120 && (
              <text
                x={usedX + (VIEW_W - usedX) / 2}
                y={VIEW_H / 2 + 4}
                textAnchor="middle"
                className="fill-muted-foreground text-[12px]"
              >
                sobra {formatMm(Math.max(0, sheetLengthMm - sheet.usedLengthMm))}
              </text>
            )}
          </g>
        )}
      </svg>
      <p className="text-xs text-muted-foreground">
        Sobrante: {formatMm(Math.max(0, sheetLengthMm - sheet.usedLengthMm))} de largo · {pieces} pieza
        {pieces !== 1 ? 's' : ''} · aprovechamiento {utilization}%
        {marginMm > 0 && ` · corte ${formatMm(marginMm)}`}
      </p>
    </div>
  )
}
