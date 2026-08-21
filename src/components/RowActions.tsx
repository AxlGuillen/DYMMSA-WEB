'use client'

import { Button } from '@/components/ui/button'
import { Pencil, Trash2 } from '@/components/icons'

interface RowActionsProps {
  onEdit: () => void
  onDelete: () => void
  /** Para lectores de pantalla y tooltip nativo: "Editar {qué}". */
  what?: string
}

/**
 * Acciones de fila siempre visibles (#55): hover no existe en táctil ni teclado.
 * El borrado conserva su AlertDialog — más alcanzable exige conservar la red.
 */
export function RowActions({ onEdit, onDelete, what }: RowActionsProps) {
  const suffix = what ? ` ${what}` : ''

  return (
    <div className="flex items-center gap-1">
      <Button
        size="icon"
        variant="ghost"
        className="size-8"
        onClick={onEdit}
        title={`Editar${suffix}`}
        aria-label={`Editar${suffix}`}
      >
        <Pencil className="size-4" />
      </Button>
      <Button
        size="icon"
        variant="ghost"
        className="size-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
        onClick={onDelete}
        title={`Eliminar${suffix}`}
        aria-label={`Eliminar${suffix}`}
      >
        <Trash2 className="size-4" />
      </Button>
    </div>
  )
}
