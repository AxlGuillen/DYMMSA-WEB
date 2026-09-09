import type { Metadata } from 'next'
import { AdminOnly } from '@/components/hours/AdminOnly'
import { TimeImportPanel } from '@/components/hours/TimeImportPanel'

export const metadata: Metadata = {
  title: 'Importar reporte | DYMMSA',
}

export default function HoursImportPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Importar reporte del checador</h1>
        <p className="text-muted-foreground">
          Sube el Excel semanal que exporta el NGTeco. Las checadas ya corregidas a mano se respetan.
        </p>
      </div>
      <AdminOnly>
        <TimeImportPanel />
      </AdminOnly>
    </div>
  )
}
