import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { DashboardMetrics } from '@/components/dashboard/DashboardMetrics'

export const metadata: Metadata = {
  title: 'Dashboard',
  description: 'Panel principal del sistema de cotizaciones DYMMSA',
}

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">
          Bienvenido, {user?.email}
        </h2>
        <p className="text-muted-foreground">
          Sistema de Cotizaciones DYMMSA
        </p>
      </div>

      <DashboardMetrics />
    </div>
  )
}
