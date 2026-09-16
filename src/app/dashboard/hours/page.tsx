import type { Metadata } from 'next'
import { HoursView } from '@/components/hours/HoursView'

export const metadata: Metadata = {
  title: 'Horas | DYMMSA',
}

export default function HoursPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Mi semana</h1>
        <p className="text-muted-foreground">
          Checadas de entrada y salida por semana, tal como las registró el checador.
        </p>
      </div>
      <HoursView />
    </div>
  )
}
