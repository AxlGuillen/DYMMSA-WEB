'use client'

import { Skeleton } from '@/components/ui/skeleton'
import { CutPlanner } from '@/components/orders/CutPlanner'
import { useCutMargin, useMaterialPresentations, type CutPlanResponse } from '@/hooks/useCutPlan'
import { useCutDraftStore } from '@/stores/cutDraftStore'

/**
 * Corte rápido (#71): standalone y EFÍMERO — piezas en localStorage, jamás en
 * BD; solo las presentaciones del proveedor persisten (ADR-022).
 */
export default function QuickCuttingPage() {
  const presentations = useMaterialPresentations()
  const margin = useCutMargin()
  const { drafts, candidates, seededFrom, setDrafts, clear } = useCutDraftStore()

  if (presentations.isLoading || margin.isLoading) return <QuickCuttingSkeleton />

  if (presentations.error || !presentations.data || margin.data == null) {
    return (
      <div className="rounded-md border p-8 text-center">
        <p className="text-muted-foreground">No se pudo cargar el planificador de corte</p>
      </div>
    )
  }

  // CutPlanResponse sintético: el CutPlanner opera igual; el id 'standalone'
  // jamás llega a un PUT (el guardado de lista está apagado en este modo).
  const data: CutPlanResponse = {
    order: { id: 'standalone', name: 'Corte rápido', customer_name: 'Corte rápido', status: 'ordered' },
    pieces: [],
    candidates,
    presentations: presentations.data.presentations,
    marginMm: margin.data,
  }

  return (
    <CutPlanner
      data={data}
      standalone={{
        initialDrafts: drafts,
        onDraftsChange: setDrafts,
        onClear: clear,
        seededFrom,
      }}
    />
  )
}

function QuickCuttingSkeleton() {
  return (
    <div className="space-y-6 pb-24">
      <div className="flex items-start gap-4">
        <Skeleton className="size-9 shrink-0 rounded-md" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-7 w-52" />
          <Skeleton className="h-4 w-96" />
        </div>
        <Skeleton className="h-8 w-40 rounded-md" />
      </div>
      {Array.from({ length: 2 }).map((_, i) => (
        <div key={i} className="space-y-3 rounded-lg border p-4">
          <Skeleton className="h-5 w-64" />
          <Skeleton className="h-8 w-full" />
        </div>
      ))}
    </div>
  )
}
