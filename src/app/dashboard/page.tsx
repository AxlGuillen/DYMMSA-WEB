import { createClient } from '@/lib/supabase/server'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

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

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Cotizador</CardTitle>
            <CardDescription>
              Sube un archivo Excel con codigos ETM y genera una cotizacion
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Disponible en Fase 4
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Catalogo</CardTitle>
            <CardDescription>
              Gestiona el catalogo de productos ETM - URREA
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Disponible en Fase 3
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Historial</CardTitle>
            <CardDescription>
              Consulta el historial de cotizaciones generadas
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Disponible en Fase 5
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
