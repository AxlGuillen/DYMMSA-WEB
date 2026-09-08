'use client'

import { useId } from 'react'
import { formatMm } from '@/lib/cut-plan'

export interface DiagramSegment {
  /** Stable key of the physical unit (piece + occurrence). */
  unitKey: string
  lengthMm: number
}

interface CutBarDiagramProps {
  barLengthMm: number
  marginMm: number
  segments: DiagramSegment[]
}

const VIEW_W = 1000
const VIEW_H = 56

/** Outside the render: the React Compiler forbids reassigning accumulators in
 *  the component body. */
function layoutSegments(segments: DiagramSegment[], marginMm: number, scale: number) {
  const rects: (DiagramSegment & { x: number; width: number })[] = []
  let cursorMm = 0
  for (const segment of segments) {
    rects.push({ ...segment, x: cursorMm * scale, width: segment.lengthMm * scale })
    cursorMm += segment.lengthMm + marginMm
  }
  return rects
}

/** SVG on purpose: it prints as-is for the shop floor (ADR-022). */
export function CutBarDiagram({ barLengthMm, marginMm, segments }: CutBarDiagramProps) {
  // Per-instance ids: SVG <pattern> resolves by global id and a page holds many diagrams.
  const kerfPatternId = useId()
  const scale = VIEW_W / barLengthMm
  const sumMm = segments.reduce((sum, s) => sum + s.lengthMm, 0)
  const usedMm = sumMm + marginMm * segments.length
  const leftoverMm = barLengthMm - usedMm
  const overflow = leftoverMm < 0

  const rects = layoutSegments(segments, marginMm, scale)

  return (
    <div className="space-y-1">
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        className={`w-full rounded border ${overflow ? 'border-red-500' : 'border-border'}`}
        role="img"
        aria-label={`Barra de ${formatMm(barLengthMm)} con ${segments.length} piezas`}
      >
        <defs>
          {/* Saw-kerf hatching (#71): distinguishable from a thin piece, which
              would be solid amber. */}
          <pattern id={kerfPatternId} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="6" height="6" className="fill-foreground/40" />
            <line x1="0" y1="0" x2="0" y2="6" className="stroke-background" strokeWidth="2.5" />
          </pattern>
        </defs>
        {/* Background = unused material, offcut included */}
        <rect x="0" y="0" width={VIEW_W} height={VIEW_H} className="fill-muted" />
        {rects.map((rect) => (
          <g key={rect.unitKey}>
            <rect
              x={rect.x}
              y={6}
              width={Math.max(1, rect.width)}
              height={VIEW_H - 12}
              rx={3}
              className="fill-amber-600/80 stroke-amber-800/60 dark:fill-amber-500/70"
            >
              <title>{formatMm(rect.lengthMm)}</title>
            </rect>
            {/* Label only when the piece is wide enough to read it */}
            {rect.width > 70 && (
              <text
                x={rect.x + rect.width / 2}
                y={VIEW_H / 2 + 4}
                textAnchor="middle"
                className="fill-white text-[13px] font-medium"
              >
                {formatMm(rect.lengthMm)}
              </text>
            )}
            {/* Kerf after the piece: hatching marks where the saw passes */}
            {marginMm > 0 && (
              <rect
                x={rect.x + rect.width}
                y={0}
                width={Math.max(2.5, marginMm * scale)}
                height={VIEW_H}
                fill={`url(#${kerfPatternId})`}
              >
                <title>{`Corte de sierra: ${formatMm(marginMm)}`}</title>
              </rect>
            )}
          </g>
        ))}
        {/* Dotted offcut, with its size when the text fits */}
        {!overflow && leftoverMm > 0 && (
          <g>
            <rect
              x={usedMm * scale}
              y={2}
              width={leftoverMm * scale - 2}
              height={VIEW_H - 4}
              className="fill-transparent stroke-muted-foreground/50"
              strokeDasharray="6 4"
            />
            {leftoverMm * scale > 110 && (
              <text
                x={usedMm * scale + (leftoverMm * scale) / 2}
                y={VIEW_H / 2 + 4}
                textAnchor="middle"
                className="fill-muted-foreground text-[12px]"
              >
                sobra {formatMm(leftoverMm)}
              </text>
            )}
          </g>
        )}
      </svg>
      <p className={`text-xs ${overflow ? 'font-medium text-red-600' : 'text-muted-foreground'}`}>
        {overflow
          ? `⚠ Excede la barra por ${formatMm(-leftoverMm)}`
          : `Sobrante: ${formatMm(Math.max(0, leftoverMm))}`}
        {' · '}{segments.length} pieza{segments.length !== 1 ? 's' : ''}
        {marginMm > 0 && ` · corte ${formatMm(marginMm)}`}
      </p>
    </div>
  )
}
