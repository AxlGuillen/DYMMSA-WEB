'use client'

import { use } from 'react'
import Link from 'next/link'
import { ArrowLeft, Loader2 } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { PurchasePlanner } from '@/components/orders/PurchasePlanner'
import { usePurchasePlan } from '@/hooks/usePurchasePlan'

interface PlannerPageProps {
  params: Promise<{ id: string }>
}

export default function PlannerPage({ params }: PlannerPageProps) {
  const { id } = use(params)
  const { data, isLoading, error } = usePurchasePlan(id)

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

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
