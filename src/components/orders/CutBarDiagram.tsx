'use client'

import { useId } from 'react'
import { formatMm } from '@/lib/cut-plan'

export interface DiagramSegment {
  /** Llave estable de la unidad física (pieza + ocurrencia), para el key. */
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

/** Posiciones acumuladas de cada segmento (fuera del render: el compilador de
 * React no permite reasignar acumuladores en el cuerpo del componente). */
function layoutSegments(segments: DiagramSegment[], marginMm: number, scale: number) {
  const rects: (DiagramSegment & { x: number; width: number })[] = []
  let cursorMm = 0
  for (const segment of segments) {
    rects.push({ ...segment, x: cursorMm * scale, width: segment.lengthMm * scale })
    cursorMm += segment.lengthMm + marginMm
  }
  return rects
}

/**
 * Barra cortada en SVG proporcional: [pieza][corte]…[sobrante punteado].
 * SVG a propósito — se imprime tal cual para el taller (ADR-022).
 */
export function CutBarDiagram({ barLengthMm, marginMm, segments }: CutBarDiagramProps) {
  // Ids únicos por instancia: una página puede tener muchos diagramas y los
  // <pattern> de SVG se resuelven por id global.
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
          {/* Achurado del paso de la sierra (issue #71): distinguible de una
              pieza delgada, que iría en ámbar sólido. */}
          <pattern id={kerfPatternId} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="6" height="6" className="fill-foreground/40" />
            <line x1="0" y1="0" x2="0" y2="6" className="stroke-background" strokeWidth="2.5" />
          </pattern>
        </defs>
        {/* Fondo = material sin usar (sobrante incluido) */}
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
            {/* Etiqueta solo si la pieza es lo bastante ancha para leerla */}
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
            {/* El corte (kerf) que sigue a la pieza: achurado = aquí pasa la sierra */}
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
        {/* Sobrante punteado, con su medida cuando cabe el texto */}
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
