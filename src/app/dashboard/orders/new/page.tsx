'use client'

import { NewOrderForm } from '@/components/orders/NewOrderForm'

export default function NewOrderPage() {
  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Nueva Orden</h1>
        <p className="text-muted-foreground">
          Sube un Excel con productos aprobados (filas verdes) para crear una orden
        </p>
      </div>

      {/* Form */}
      <NewOrderForm />
    </div>
  )
}
