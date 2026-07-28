'use client'

import { Check, Ban } from '@/components/icons'

interface SoldStatusToggleProps {
  /** Tri-estado: null = sin definir, true = lo vendemos, false = no lo vendemos. */
  value: boolean | null
  onChange: (next: boolean | null) => void
  disabled?: boolean
}

/**
 * Toggle rápido de "¿lo vendemos?" (issue #55), con el mismo gesto que aprobar
 * un producto en `/approve/[token]`: un click marca, y volver a hacer click en
 * el botón ACTIVO regresa a "sin definir".
 *
 * Ese regreso a `null` importa: `is_sold` es tri-estado y solo los valores
 * explícitos (true/false) pisan el catálogo vía auto-learn — sin esto no habría
 * forma de deshacer una marca puesta por error desde la tabla.
 */
export function SoldStatusToggle({ value, onChange, disabled }: SoldStatusToggleProps) {
  const base = 'rounded p-1 transition-colors disabled:opacity-50 disabled:pointer-events-none'

  return (
    <div className="flex items-center justify-center gap-1">
      <button
        type="button"
        disabled={disabled}
        aria-pressed={value === true}
        title={value === true ? 'Quitar "se vende"' : 'Marcar: se vende'}
        aria-label={value === true ? 'Quitar "se vende"' : 'Marcar: se vende'}
        onClick={() => onChange(value === true ? null : true)}
        className={`${base} ${
          value === true
            ? 'bg-green-100 text-green-600 dark:bg-green-900/30'
            : 'text-muted-foreground hover:bg-green-50 hover:text-green-600 dark:hover:bg-green-900/20'
        }`}
      >
        <Check className="size-4" />
      </button>
      <button
        type="button"
        disabled={disabled}
        aria-pressed={value === false}
        title={value === false ? 'Quitar "no se vende"' : 'Marcar: no se vende'}
        aria-label={value === false ? 'Quitar "no se vende"' : 'Marcar: no se vende'}
        onClick={() => onChange(value === false ? null : false)}
        className={`${base} ${
          value === false
            ? 'bg-rose-100 text-rose-600 dark:bg-rose-900/30'
            : 'text-muted-foreground hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-900/20'
        }`}
      >
        <Ban className="size-4" />
      </button>
    </div>
  )
}
