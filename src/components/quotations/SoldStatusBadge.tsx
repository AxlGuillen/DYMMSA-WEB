import { Badge } from '@/components/ui/badge'
import { Ban, Check } from 'lucide-react'
import type { SoldValue } from '@/lib/sold-status'

/**
 * Badge del estado "¿lo vendemos?".
 *  - false → "No se vende" (rojo)
 *  - true  → "Se vende" (verde)
 *  - null/undefined → guion discreto (la mayoría de las filas están sin definir)
 */
export function SoldStatusBadge({ value }: { value: SoldValue }) {
  if (value === false) {
    return (
      <Badge variant="outline" className="text-xs text-rose-600 border-rose-300 gap-1">
        <Ban className="size-3" />
        No se vende
      </Badge>
    )
  }
  if (value === true) {
    return (
      <Badge variant="outline" className="text-xs text-green-600 border-green-300 gap-1">
        <Check className="size-3" />
        Se vende
      </Badge>
    )
  }
  return <span className="text-muted-foreground text-xs">{'—'}</span>
}
