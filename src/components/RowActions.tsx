'use client'

import { Button } from '@/components/ui/button'
import { Pencil, Trash2 } from '@/components/icons'

interface RowActionsProps {
  onEdit: () => void
  onDelete: () => void
  /** For screen readers and the native tooltip: "Editar {what}". */
  what?: string
}

/** Always visible (#55): hover exists on neither touch nor keyboard. Delete keeps
 *  its AlertDialog — easier to reach means the net must stay. */
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
