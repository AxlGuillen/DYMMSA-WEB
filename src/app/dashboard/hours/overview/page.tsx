import type { Metadata } from 'next'
import { AdminOnly } from '@/components/hours/AdminOnly'
import { TeamHoursOverview } from '@/components/hours/TeamHoursOverview'

export const metadata: Metadata = {
  title: 'Resumen del equipo | DYMMSA',
}

export default function HoursOverviewPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Resumen del equipo</h1>
        <p className="text-muted-foreground">Horas de la semana de la oficina y del taller, de todos o por persona.</p>
      </div>
      <AdminOnly>
        <TeamHoursOverview />
      </AdminOnly>
    </div>
  )
}
