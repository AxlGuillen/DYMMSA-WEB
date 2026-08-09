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
 * Acciones de fila accesibles al PRIMER click (issue #55).
 *
 * Antes vivían dentro de un menú "···" que además solo aparecía al hacer hover:
 * eran dos clicks y un objetivo invisible hasta acercarse. Se dejan siempre
 * visibles porque `hover` no existe en táctil ni con teclado.
 *
 * El borrado sigue confirmándose con AlertDialog en cada tabla — sacar el botón
 * del menú lo hace más alcanzable, y esa es justo la razón para conservar la red.
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
