import type { Metadata } from 'next'
import { FinanceOverview } from '@/components/finance/FinanceOverview'

export const metadata: Metadata = {
  title: 'Finanzas | DYMMSA',
}

export default function FinancePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Finanzas</h1>
        <p className="text-muted-foreground">
          Cobros de Odoo y egresos pendientes del mes — para decidir qué pagar y cuándo.
        </p>
      </div>
      <FinanceOverview />
    </div>
  )
}
