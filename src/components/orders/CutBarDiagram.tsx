'use client'

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
 * Diagrama SVG de una barra cortada (issue #59): [pieza][corte][pieza]…[sobrante].
 * Proporcional al largo real; el sobrante va punteado y los cortes en oscuro.
 * SVG a propósito (no 3D): un corte lineal ES una barra segmentada, y así el
 * diagrama se imprime tal cual para llevarlo al taller.
 */
export function CutBarDiagram({ barLengthMm, marginMm, segments }: CutBarDiagramProps) {
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
            {/* El corte (kerf) que sigue a la pieza */}
            {marginMm > 0 && (
              <rect
                x={rect.x + rect.width}
                y={0}
                width={Math.max(1.5, marginMm * scale)}
                height={VIEW_H}
                className="fill-foreground/50"
              />
            )}
          </g>
        ))}
        {/* Sobrante punteado */}
        {!overflow && leftoverMm > 0 && (
          <rect
            x={usedMm * scale}
            y={2}
            width={leftoverMm * scale - 2}
            height={VIEW_H - 4}
            className="fill-transparent stroke-muted-foreground/50"
            strokeDasharray="6 4"
          />
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
