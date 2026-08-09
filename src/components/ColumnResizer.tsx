'use client'

import { useRef } from 'react'
import { MIN_COLUMN_WIDTH } from '@/hooks/useColumnWidths'

interface ColumnResizerProps {
  /** Ancho actual de la columna en px (punto de partida del arrastre). */
  width: number
  onResize: (width: number) => void
  /** Doble click / tecla Home: vuelve al ancho por defecto. */
  onReset: () => void
  label?: string
}

const KEYBOARD_STEP = 16

/**
 * Manija de redimensionado en el borde derecho de un `<th>` (issue #55).
 *
 * El `<th>` contenedor debe ser `relative`. Usa Pointer Events + captura para
 * que el arrastre siga funcionando aunque el cursor salga del `<th>` (arrastres
 * rápidos) y `stopPropagation` para no disparar el ordenamiento del header.
 */
export function ColumnResizer({ width, onResize, onReset, label }: ColumnResizerProps) {
  const start = useRef({ x: 0, width: 0 })

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    // Solo botón principal; evita que el header dispare sort o selección.
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()

    start.current = { x: event.clientX, width }
    const target = event.currentTarget
    target.setPointerCapture(event.pointerId)

    const handleMove = (moveEvent: PointerEvent) => {
      onResize(start.current.width + (moveEvent.clientX - start.current.x))
    }
    const handleUp = () => {
      target.releasePointerCapture(event.pointerId)
      target.removeEventListener('pointermove', handleMove)
      target.removeEventListener('pointerup', handleUp)
      document.body.classList.remove('select-none')
    }

    target.addEventListener('pointermove', handleMove)
    target.addEventListener('pointerup', handleUp)
    // Sin esto el arrastre va seleccionando el texto de las celdas.
    document.body.classList.add('select-none')
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      onResize(Math.max(MIN_COLUMN_WIDTH, width - KEYBOARD_STEP))
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      onResize(width + KEYBOARD_STEP)
    } else if (event.key === 'Home') {
      event.preventDefault()
      onReset()
    }
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label ? `Ajustar ancho de ${label}` : 'Ajustar ancho de columna'}
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onDoubleClick={(event) => {
        event.stopPropagation()
        onReset()
      }}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={handleKeyDown}
      className="group/resizer absolute top-0 right-0 z-10 flex h-full w-3 translate-x-1/2 cursor-col-resize items-center justify-center focus:outline-none"
    >
      <span className="bg-border group-hover/resizer:bg-primary group-focus/resizer:bg-primary h-1/2 w-px transition-colors group-hover/resizer:w-0.5 group-focus/resizer:w-0.5" />
    </div>
  )
}
