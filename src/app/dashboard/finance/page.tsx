import type { Metadata } from 'next'
import { FinanceOverview } from '@/components/finance/FinanceOverview'
import { TourButton } from '@/components/tours/TourButton'

export const metadata: Metadata = {
  title: 'Finanzas | DYMMSA',
}

export default function FinancePage() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Finanzas</h1>
          <p className="text-muted-foreground">
            Cobros de Odoo y egresos pendientes del mes — para decidir qué pagar y cuándo.
          </p>
        </div>
        <TourButton tour="finance-overview" />
      </div>
      <FinanceOverview />
    </div>
  )
}
