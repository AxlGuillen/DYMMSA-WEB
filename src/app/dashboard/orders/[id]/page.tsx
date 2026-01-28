'use client'

import { use } from 'react'
import Link from 'next/link'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { OrderDetail } from '@/components/orders/OrderDetail'
import { useOrder } from '@/hooks/useOrders'

interface OrderDetailPageProps {
  params: Promise<{ id: string }>
}

export default function OrderDetailPage({ params }: OrderDetailPageProps) {
  const { id } = use(params)
  const { data: order, isLoading, error } = useOrder(id)

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error || !order) {
    return (
      <div className="space-y-6">
        <Link href="/dashboard/orders">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Volver a órdenes
          </Button>
        </Link>
        <div className="rounded-md border p-8 text-center">
          <p className="text-muted-foreground">Orden no encontrada</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Back Button */}
      <Link href="/dashboard/orders">
        <Button className='mb-6' variant="ghost" size="sm">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Volver a órdenes
        </Button>
      </Link>

      {/* Order Detail */}
      <OrderDetail order={order} />
    </div>
  )
}
