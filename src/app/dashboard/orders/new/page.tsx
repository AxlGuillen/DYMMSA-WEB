'use client'

import { NewOrderForm } from '@/components/orders/NewOrderForm'

export default function NewOrderPage() {
  return (
    <div className="max-w-8xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Nueva Orden</h1>
        <p className="text-muted-foreground">
          Sube un Excel con productos aprobados (filas verdes) para crear una orden
        </p>
      </div>

      <NewOrderForm />
    </div>
  )
}
