import type { Metadata } from 'next'
import { AdminOnly } from '@/components/hours/AdminOnly'
import { TeamTable } from '@/components/hours/TeamTable'
import { TourButton } from '@/components/tours/TourButton'

export const metadata: Metadata = {
  title: 'Equipo | DYMMSA',
}

export default function HoursTeamPage() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between" data-tour="team-header">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Equipo</h1>
          <p className="text-muted-foreground">
            Roles, el id con el que cada persona aparece en el reporte del checador y su jornada.
          </p>
        </div>
        <TourButton tour="team" />
      </div>
      <AdminOnly>
        <TeamTable />
      </AdminOnly>
    </div>
  )
}
