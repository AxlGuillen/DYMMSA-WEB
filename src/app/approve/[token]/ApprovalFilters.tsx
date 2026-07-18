'use client'

import { CheckSquare, X } from '@/components/icons'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { hasActiveFilters, type ApprovalFilters as Filters } from '@/lib/approval-filters'

interface ApprovalFiltersProps {
  brands: string[]
  sections: string[]
  filters: Filters
  onChange: (filters: Filters) => void
  /** Nº de productos visibles bajo el filtro (para el botón contextual). */
  visibleCount: number
  onApproveVisible: () => void
}

/**
 * Filtros de la aprobación (issue #24): marca y proyecto/sección + botón
 * contextual de "aprobar lo visible". Vive en el encabezado de la card de
 * productos (arriba de la tabla) — antes era una barra sticky aparte que
 * rompía con el diseño y truncaba las etiquetas. Los triggers usan ancho
 * automático (`w-auto` + `min-w`) para que ninguna opción se corte.
 * Cada Select solo aparece si hay más de una opción que filtrar.
 */
export function ApprovalFilters({
  brands,
  sections,
  filters,
  onChange,
  visibleCount,
  onApproveVisible,
}: ApprovalFiltersProps) {
  const active = hasActiveFilters(filters)

  return (
    <div className="flex flex-wrap items-center gap-2">
      {brands.length > 1 && (
        <Select
          value={filters.brand}
          onValueChange={(brand) => onChange({ ...filters, brand })}
        >
          <SelectTrigger className="h-8 w-auto min-w-[9.5rem] whitespace-nowrap rounded-full bg-card/60 text-xs">
            <SelectValue placeholder="Marca" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas las marcas</SelectItem>
            {brands.map((brand) => (
              <SelectItem key={brand} value={brand}>{brand}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {sections.length > 1 && (
        <Select
          value={filters.section}
          onValueChange={(section) => onChange({ ...filters, section })}
        >
          <SelectTrigger className="h-8 w-auto min-w-[10.5rem] whitespace-nowrap rounded-full bg-card/60 text-xs">
            <SelectValue placeholder="Proyecto" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los proyectos</SelectItem>
            {sections.map((section) => (
              <SelectItem key={section} value={section}>{section}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {active && (
        <Button
          variant="ghost"
          size="sm"
          className="h-8 rounded-full text-muted-foreground"
          onClick={() => onChange({ brand: 'all', section: 'all' })}
        >
          <X className="mr-1 size-3.5" />
          Limpiar
        </Button>
      )}

      <Button
        size="sm"
        variant="outline"
        className="h-8 whitespace-nowrap rounded-full"
        onClick={onApproveVisible}
        disabled={visibleCount === 0}
      >
        <CheckSquare className="mr-1.5 size-4" />
        {active ? `Aprobar ${visibleCount} visible${visibleCount !== 1 ? 's' : ''}` : 'Aprobar todos'}
      </Button>
    </div>
  )
}
