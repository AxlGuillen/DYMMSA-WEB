'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  SEPARATOR_COLOR_KEYS,
  SEPARATOR_PALETTE,
  isSeparatorColor,
} from '@/lib/separator-palette'
import { cn } from '@/lib/utils'

interface SeparatorColorPickerProps {
  /** Override guardado; null = color automático por índice de sección. */
  value: string | null | undefined
  onChange: (color: string | null) => void
  disabled?: boolean
}

/**
 * Selector de color de un separador (issue #73): swatches fijos de la paleta
 * + "Automático" para volver a la rotación por sección. Vive dentro de la
 * celda del label (no agrega columnas a la tabla).
 */
export function SeparatorColorPicker({ value, onChange, disabled }: SeparatorColorPickerProps) {
  const [open, setOpen] = useState(false)
  const current = isSeparatorColor(value) ? value : null

  const pick = (color: string | null) => {
    onChange(color)
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-7 shrink-0"
          disabled={disabled}
          title="Color de la sección"
          aria-label="Color de la sección"
        >
          <span
            className={cn(
              'size-3.5 rounded-full border border-border/60',
              current ? SEPARATOR_PALETTE[current].swatch : 'bg-transparent',
            )}
          />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-2">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => pick(null)}
            title="Automático (rota por sección)"
            aria-label="Color automático"
            className={cn(
              'flex size-6 items-center justify-center rounded-full border text-[10px] text-muted-foreground transition-transform hover:scale-110',
              current === null && 'ring-2 ring-primary ring-offset-1 ring-offset-background',
            )}
          >
            A
          </button>
          {SEPARATOR_COLOR_KEYS.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => pick(key)}
              title={SEPARATOR_PALETTE[key].label}
              aria-label={`Color ${SEPARATOR_PALETTE[key].label}`}
              className={cn(
                'size-6 rounded-full transition-transform hover:scale-110',
                SEPARATOR_PALETTE[key].swatch,
                current === key && 'ring-2 ring-primary ring-offset-1 ring-offset-background',
              )}
            />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
