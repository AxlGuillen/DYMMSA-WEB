'use client'

import { use } from 'react'
import Link from 'next/link'
import { ArrowLeft } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { PurchasePlanner } from '@/components/orders/PurchasePlanner'
import { usePurchasePlan } from '@/hooks/usePurchasePlan'

interface PlannerPageProps {
  params: Promise<{ id: string }>
}

export default function PlannerPage({ params }: PlannerPageProps) {
  const { id } = use(params)
  const { data, isLoading, error } = usePurchasePlan(id)

  if (isLoading) return <PlannerSkeleton />

  if (error || !data) {
    return (
      <div className="space-y-6">
        <Link href={`/dashboard/orders/${id}`}>
          <Button variant="ghost" size="sm">
            <ArrowLeft className="mr-2 size-4" />
            Volver a la orden
          </Button>
        </Link>
        <div className="rounded-md border p-8 text-center">
          <p className="text-muted-foreground">No se pudo cargar el plan de compra</p>
        </div>
      </div>
    )
  }

  return <PurchasePlanner data={data} />
}

/**
 * Esqueleto con la MISMA forma del planificador (encabezado, 4 tarjetas de
 * resumen y las filas de grupo). Antes había un spinner centrado, que no
 * anticipa nada y hace sentir la espera más larga en órdenes grandes.
 */
function PlannerSkeleton() {
  return (
    <div className="space-y-6 pb-24">
      <div className="flex items-start gap-4">
        <Skeleton className="size-9 shrink-0 rounded-md" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-7 w-56" />
          <Skeleton className="h-4 w-80" />
          <div className="flex gap-2 pt-1">
            <Skeleton className="h-5 w-24 rounded-full" />
            <Skeleton className="h-5 w-28 rounded-full" />
          </div>
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-8 w-24 rounded-md" />
          <Skeleton className="h-8 w-28 rounded-md" />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-lg border bg-card px-4 py-3 space-y-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-6 w-20" />
            <Skeleton className="h-3 w-28" />
          </div>
        ))}
      </div>

      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="rounded-md border p-3 space-y-2">
            <div className="flex items-center gap-3">
              <Skeleton className="size-4 rounded" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-5 w-16 rounded-full" />
              <Skeleton className="h-4 w-64" />
            </div>
            <Skeleton className="h-3 w-96" />
            <Skeleton className="h-4 w-72" />
          </div>
        ))}
      </div>
    </div>
  )
}
