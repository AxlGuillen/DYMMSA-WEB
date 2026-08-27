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

/**
 * Hoja de placa vista desde arriba (#64/#81): largo en X, ancho en Y. Cada
 * pieza va en su posición real del acomodo por carriles; sobrantes punteados
 * por carril y en la banda de ancho libre. Imprimible para el taller.
 */
export function CutSheetDiagram({ sheetWidthMm, sheetLengthMm, marginMm, sheet }: CutSheetDiagramProps) {
  const kerfPatternId = useId()
  if (sheetLengthMm <= 0 || sheetWidthMm <= 0) return null
  const scaleX = VIEW_W / sheetLengthMm
  const scaleY = VIEW_H / sheetWidthMm

  const pieces = sheet.lanes.reduce((n, lane) => n + lane.items.length, 0)
  const usedArea = sheet.lanes.reduce(
    (sum, lane) => sum + lane.items.reduce((s, i) => s + i.widthMm * i.lengthMm, 0),
    0,
  )
  const utilization = Math.round((usedArea / (sheetLengthMm * sheetWidthMm)) * 100)
  const leftoverWidthMm = sheetWidthMm - sheet.usedWidthMm

  return (
    <div className="space-y-1">
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        className="w-full rounded border border-border"
        role="img"
        aria-label={`Hoja de ${formatMm(sheetLengthMm)} × ${formatMm(sheetWidthMm)} con ${pieces} piezas`}
      >
        <defs>
          {/* Achurado del paso de la sierra (#71), como en las barras. */}
          <pattern id={kerfPatternId} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="6" height="6" className="fill-foreground/40" />
            <line x1="0" y1="0" x2="0" y2="6" className="stroke-background" strokeWidth="2.5" />
          </pattern>
        </defs>
        <rect x="0" y="0" width={VIEW_W} height={VIEW_H} className="fill-muted" />

        {sheet.lanes.map((lane, laneIndex) => {
          const laneY = lane.yMm * scaleY
          const laneH = lane.widthMm * scaleY
          const laneLeftoverMm = sheetLengthMm - lane.usedLengthMm
          return (
            <g key={laneIndex}>
              {/* Corte entre carriles (rip a lo largo de lo usado) */}
              {marginMm > 0 && laneIndex > 0 && (
                <rect
                  x={0}
                  y={(lane.yMm - marginMm) * scaleY}
                  width={Math.min(VIEW_W, sheet.usedLengthMm * scaleX)}
                  height={Math.max(2, marginMm * scaleY)}
                  fill={`url(#${kerfPatternId})`}
                >
                  <title>{`Corte de sierra: ${formatMm(marginMm)}`}</title>
                </rect>
              )}
              {lane.items.map((item, itemIndex) => {
                const w = item.lengthMm * scaleX
                const h = item.widthMm * scaleY
                return (
                  <g key={`${item.pieceId}-${itemIndex}`}>
                    <rect
                      x={item.xMm * scaleX}
                      y={item.yMm * scaleY}
                      width={Math.max(1, w - 2)}
                      height={Math.max(1, h - 2)}
                      rx={3}
                      className="fill-amber-600/80 stroke-amber-800/60 dark:fill-amber-500/70"
                    >
                      <title>{`${formatMm(item.widthMm)} × ${formatMm(item.lengthMm)}${item.rotated ? ' (rotada 90°)' : ''}`}</title>
                    </rect>
                    {w > 90 && h > 22 && (
                      <text
                        x={item.xMm * scaleX + w / 2}
                        y={item.yMm * scaleY + h / 2 + 4}
                        textAnchor="middle"
                        className="fill-white text-[12px] font-medium"
                      >
                        {item.widthMm}×{item.lengthMm}
                      </text>
                    )}
                    {/* Corte tras la pieza dentro del carril (si algo la sigue) */}
                    {marginMm > 0 && item.xMm + item.lengthMm < lane.usedLengthMm && (
                      <rect
                        x={(item.xMm + item.lengthMm) * scaleX}
                        y={item.yMm * scaleY}
                        width={Math.max(2, marginMm * scaleX)}
                        height={h}
                        fill={`url(#${kerfPatternId})`}
                      >
                        <title>{`Corte de sierra: ${formatMm(marginMm)}`}</title>
                      </rect>
                    )}
                  </g>
                )
              })}
              {/* Sobrante del carril a lo largo */}
              {laneLeftoverMm * scaleX > 8 && (
                <rect
                  x={lane.usedLengthMm * scaleX + 2}
                  y={laneY + 2}
                  width={laneLeftoverMm * scaleX - 4}
                  height={Math.max(2, laneH - 4)}
                  rx={3}
                  className="fill-transparent stroke-muted-foreground/50 [stroke-dasharray:6_5]"
                />
              )}
              {laneLeftoverMm * scaleX > 120 && laneH > 24 && (
                <text
                  x={(lane.usedLengthMm + laneLeftoverMm / 2) * scaleX}
                  y={laneY + laneH / 2 + 4}
                  textAnchor="middle"
                  className="fill-muted-foreground text-[12px]"
                >
                  sobra {formatMm(laneLeftoverMm)}
                </text>
              )}
            </g>
          )
        })}

        {/* Banda de ancho libre (abajo), punteada */}
        {leftoverWidthMm * scaleY > 8 && (
          <rect
            x={2}
            y={sheet.usedWidthMm * scaleY + 2}
            width={VIEW_W - 4}
            height={leftoverWidthMm * scaleY - 4}
            rx={3}
            className="fill-transparent stroke-muted-foreground/50 [stroke-dasharray:6_5]"
          />
        )}
      </svg>
      <p className="text-xs text-muted-foreground">
        Sobrante: {formatMm(Math.max(0, sheetLengthMm - sheet.usedLengthMm))} de largo
        {leftoverWidthMm > 0 && ` · ${formatMm(leftoverWidthMm)} de ancho libre`}
        {' '}· {pieces} pieza{pieces !== 1 ? 's' : ''} · aprovechamiento {utilization}%
        {marginMm > 0 && ` · corte ${formatMm(marginMm)}`}
      </p>
    </div>
  )
}
