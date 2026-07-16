'use client'

import { Loader2, Send } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { formatMoney } from './format'

interface ApprovalDockProps {
  approvedCount: number
  totalCount: number
  approvedTotal: number
  isSaving: boolean
  isSubmitting: boolean
  onSave: () => void
  onSend: () => void
}

/**
 * Dock flotante sticky con el progreso GLOBAL de aprobación (no filtrado) y las
 * acciones definitivas. Siempre visible al hacer scroll (issue #24).
 */
export function ApprovalDock({
  approvedCount,
  totalCount,
  approvedTotal,
  isSaving,
  isSubmitting,
  onSave,
  onSend,
}: ApprovalDockProps) {
  const pct = totalCount > 0 ? Math.round((approvedCount / totalCount) * 100) : 0
  const deg = totalCount > 0 ? Math.round((approvedCount / totalCount) * 360) : 0
  const busy = isSaving || isSubmitting

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-5 z-50 flex justify-center px-4">
      <div className="pointer-events-auto flex flex-wrap items-center justify-center gap-x-5 gap-y-3 rounded-[26px] border border-border/70 bg-card/85 px-4 py-3 shadow-2xl backdrop-blur-2xl sm:rounded-full sm:px-5">
        {/* Anillo de progreso + conteo */}
        <div className="flex items-center gap-3">
          <div
            className="relative size-11 shrink-0 rounded-full"
            style={{ background: `conic-gradient(#16a34a ${deg}deg, var(--muted) ${deg}deg)` }}
            aria-hidden
          >
            <div className="absolute inset-[3px] flex items-center justify-center rounded-full bg-card">
              <span className="text-[11px] font-bold tabular-nums text-green-600 dark:text-green-400">
                {pct}%
              </span>
            </div>
          </div>
          <div className="leading-tight">
            <div className="flex items-baseline gap-1.5">
              <span className="text-base font-bold tabular-nums text-green-600 dark:text-green-400">
                {approvedCount}
              </span>
              <span className="text-xs text-muted-foreground">/ {totalCount} aprobados</span>
            </div>
            <div className="text-[11px] tabular-nums text-muted-foreground">
              Total aprobado {formatMoney(approvedTotal)}
            </div>
          </div>
        </div>

        <div className="hidden h-8 w-px bg-border sm:block" />

        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={onSave} disabled={busy} className="rounded-full">
            {isSaving ? (
              <><Loader2 className="mr-2 size-4 animate-spin" />Guardando…</>
            ) : (
              'Guardar avance'
            )}
          </Button>
          <Button
            onClick={onSend}
            disabled={busy || approvedCount === 0}
            className="rounded-full shadow-md"
          >
            {isSubmitting ? (
              <><Loader2 className="mr-2 size-4 animate-spin" />Enviando…</>
            ) : (
              <><Send className="mr-2 size-4" />Enviar aprobación</>
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}
