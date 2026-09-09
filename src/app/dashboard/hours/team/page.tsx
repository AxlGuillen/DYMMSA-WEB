import type { Metadata } from 'next'
import { AdminOnly } from '@/components/hours/AdminOnly'
import { TeamTable } from '@/components/hours/TeamTable'

export const metadata: Metadata = {
  title: 'Equipo | DYMMSA',
}

export default function HoursTeamPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Equipo</h1>
        <p className="text-muted-foreground">
          Roles y el id con el que cada persona aparece en el reporte del checador.
        </p>
      </div>
      <AdminOnly>
        <TeamTable />
      </AdminOnly>
    </div>
  )
}
