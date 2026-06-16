import type { Metadata } from 'next'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { DashboardMetrics } from '@/components/dashboard/DashboardMetrics'
import { Button } from '@/components/ui/button'
import { CalendarDays, PlusCircle, FileText, ShoppingCart } from 'lucide-react'

export const metadata: Metadata = {
  title: 'Dashboard',
  description: 'Panel principal del sistema de cotizaciones DYMMSA',
}

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const username = (user?.user_metadata?.full_name as string | undefined) || user?.email?.split('@')[0] || 'usuario'
  const today = new Date().toLocaleDateString('es-MX', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
  const formattedDate = today.charAt(0).toUpperCase() + today.slice(1)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">
            Bienvenido, {username}
          </h2>
          <div className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
            <CalendarDays className="size-3.5" />
            {formattedDate}
          </div>
        </div>

        {/* Quick actions */}
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm" variant="outline">
            <Link href="/dashboard/quoter">
              <PlusCircle className="mr-1.5 size-3.5" />
              Nueva cotizacion
            </Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href="/dashboard/quotations">
              <FileText className="mr-1.5 size-3.5" />
              Cotizaciones
            </Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href="/dashboard/orders">
              <ShoppingCart className="mr-1.5 size-3.5" />
              Ordenes
            </Link>
          </Button>
        </div>
      </div>

      <DashboardMetrics />
    </div>
  )
}
