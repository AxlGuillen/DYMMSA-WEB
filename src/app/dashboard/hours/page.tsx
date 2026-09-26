import type { Metadata } from 'next'
import { HoursView } from '@/components/hours/HoursView'
import { TourButton } from '@/components/tours/TourButton'

export const metadata: Metadata = {
  title: 'Horas | DYMMSA',
}

export default function HoursPage() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Mi semana</h1>
          <p className="text-muted-foreground">
            Checadas de entrada y salida por semana, tal como las registró el checador.
          </p>
        </div>
        <TourButton tour="hours" />
      </div>
      <HoursView />
    </div>
  )
}
