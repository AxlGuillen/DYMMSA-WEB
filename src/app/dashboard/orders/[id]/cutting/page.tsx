'use client'

import { use } from 'react'
import Link from 'next/link'
import { ArrowLeft } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { CutPlanner } from '@/components/orders/CutPlanner'
import { useCutPlan } from '@/hooks/useCutPlan'

interface CuttingPageProps {
  params: Promise<{ id: string }>
}

export default function CuttingPage({ params }: CuttingPageProps) {
  const { id } = use(params)
  const { data, isLoading, error } = useCutPlan(id)

  if (isLoading) return <CuttingSkeleton />

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
          <p className="text-muted-foreground">No se pudo cargar el plan de corte</p>
        </div>
      </div>
    )
  }

  return <CutPlanner data={data} />
}

/** Silueta del contenido real (encabezado, lista y un grupo de diámetro). */
function CuttingSkeleton() {
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
          <Skeleton className="h-14 w-full rounded" />
        </div>
      ))}
    </div>
  )
}
