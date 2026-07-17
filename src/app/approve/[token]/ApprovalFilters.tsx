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
 * Barra de filtros de la aprobación (issue #24): filtro por marca y por
 * proyecto/sección + botón contextual de "aprobar lo visible". Sticky bajo el
 * header para no perderla al hacer scroll en cotizaciones grandes.
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
    <div className="sticky top-[73px] z-30 -mx-4 border-b border-border/60 bg-background/70 px-4 py-3 backdrop-blur-xl sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-2.5">
        <Select
          value={filters.brand}
          onValueChange={(brand) => onChange({ ...filters, brand })}
        >
          <SelectTrigger className="h-9 w-[150px] rounded-full">
            <SelectValue placeholder="Marca" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas las marcas</SelectItem>
            {brands.map((brand) => (
              <SelectItem key={brand} value={brand}>{brand}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={filters.section}
          onValueChange={(section) => onChange({ ...filters, section })}
        >
          <SelectTrigger className="h-9 w-[170px] rounded-full">
            <SelectValue placeholder="Proyecto" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los proyectos</SelectItem>
            {sections.map((section) => (
              <SelectItem key={section} value={section}>{section}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {active && (
          <Button
            variant="ghost"
            size="sm"
            className="h-9 rounded-full text-muted-foreground"
            onClick={() => onChange({ brand: 'all', section: 'all' })}
          >
            <X className="mr-1 size-3.5" />
            Limpiar
          </Button>
        )}

        <div className="ml-auto">
          <Button
            size="sm"
            variant="outline"
            className="h-9 rounded-full"
            onClick={onApproveVisible}
            disabled={visibleCount === 0}
          >
            <CheckSquare className="mr-1.5 size-4" />
            {active ? `Aprobar ${visibleCount} visible${visibleCount !== 1 ? 's' : ''}` : 'Aprobar todos'}
          </Button>
        </div>
      </div>
    </div>
  )
}
