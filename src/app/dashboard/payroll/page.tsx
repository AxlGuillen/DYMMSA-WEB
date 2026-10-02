import type { Metadata } from 'next'
import { AdminOnly } from '@/components/hours/AdminOnly'
import { PayrollView } from '@/components/payroll/PayrollView'

export const metadata: Metadata = {
  title: 'Nómina | DYMMSA',
}

export default function PayrollPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Nómina</h1>
        <p className="text-muted-foreground">
          Horas por empleado del corte que se paga el viernes: del sábado anterior al propio viernes.
        </p>
      </div>
      <AdminOnly>
        <PayrollView />
      </AdminOnly>
    </div>
  )
}
