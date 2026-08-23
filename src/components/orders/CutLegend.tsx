'use client'

/**
 * Leyenda compartida de los diagramas de corte (issue #71): qué es pieza, qué
 * es el paso de la sierra y qué es sobrante — una por grupo, no por diagrama.
 */
export function CutLegend({ showKerf }: { showKerf: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground print:text-[10px]">
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block h-3 w-5 rounded-[3px] bg-amber-600/80 dark:bg-amber-500/70" />
        pieza
      </span>
      {showKerf && (
        <span className="inline-flex items-center gap-1.5">
          <span
            className="inline-block h-3 w-2.5 bg-foreground/40"
            style={{
              backgroundImage:
                'repeating-linear-gradient(45deg, transparent, transparent 2px, var(--background) 2px, var(--background) 4px)',
            }}
          />
          corte de sierra
        </span>
      )}
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block h-3 w-5 rounded-[3px] border border-dashed border-muted-foreground/60" />
        sobrante
      </span>
    </div>
  )
}
