'use client'

import { formatMm } from '@/lib/cut-plan'
import type { PackedShelf } from '@/lib/cut-plan'

interface CutStripDiagramProps {
  stripWidthMm: number
  marginMm: number
  shelves: PackedShelf[]
  totalLengthMm: number
}

const VIEW_W = 1000
const VIEW_H = 140

/** Posiciones X acumuladas de cada fila (fuera del render por el compilador de React). */
function layoutShelves(shelves: PackedShelf[], marginMm: number, scaleX: number) {
  const out: (PackedShelf & { x: number })[] = []
  let cursorMm = 0
  for (const shelf of shelves) {
    out.push({ ...shelf, x: cursorMm * scaleX })
    cursorMm += shelf.lengthMm + marginMm
  }
  return out
}

/**
 * Diagrama SVG de una tira de placa vista desde arriba (issue #59): el largo
 * corre en X, el ancho de la tira en Y. Cada fila (shelf) consume el largo de
 * su pieza más larga; los cortes entre filas van en oscuro. Igual que el de
 * barras: SVG imprimible para llevar al taller, sin 3D que no aporta.
 */
export function CutStripDiagram({ stripWidthMm, marginMm, shelves, totalLengthMm }: CutStripDiagramProps) {
  if (totalLengthMm <= 0) return null
  const scaleX = VIEW_W / totalLengthMm
  const scaleY = VIEW_H / stripWidthMm
  const positioned = layoutShelves(shelves, marginMm, scaleX)

  const usedArea = shelves.reduce(
    (sum, shelf) => sum + shelf.items.reduce((s, i) => s + i.widthMm * i.lengthMm, 0),
    0,
  )
  const utilization = Math.round((usedArea / (totalLengthMm * stripWidthMm)) * 100)

  return (
    <div className="space-y-1">
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        className="w-full rounded border border-border"
        role="img"
        aria-label={`Tira de ${formatMm(totalLengthMm)} × ${formatMm(stripWidthMm)} con ${shelves.reduce((n, s) => n + s.items.length, 0)} piezas`}
      >
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
            {/* Corte entre filas */}
            {marginMm > 0 && shelfIndex < positioned.length - 1 && (
              <rect
                x={shelf.x + shelf.lengthMm * scaleX}
                y={0}
                width={Math.max(1.5, marginMm * scaleX)}
                height={VIEW_H}
                className="fill-foreground/50"
              />
            )}
          </g>
        ))}
      </svg>
      <p className="text-xs text-muted-foreground">
        Pide {formatMm(totalLengthMm)} de tira de {formatMm(stripWidthMm)} · aprovechamiento{' '}
        {utilization}%{marginMm > 0 && ` · corte ${formatMm(marginMm)}`}
      </p>
    </div>
  )
}
