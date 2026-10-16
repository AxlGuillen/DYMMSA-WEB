import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { AlertTriangle } from '@/components/icons'
import type { CustomersUnavailableReason } from '@/lib/customers'

const MESSAGES: Record<CustomersUnavailableReason, string> = {
  not_configured: 'La conexión con Odoo no está configurada en el servidor.',
  odoo_error: 'No se pudo leer Odoo en este momento. Intenta de nuevo con Actualizar.',
}

/** Odoo absent or down: the screen says so instead of breaking (same rule as the income, ADR-027). */
export function OdooUnavailable({ reason, failed }: { reason: CustomersUnavailableReason | null; failed: boolean }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <AlertTriangle className="size-4 text-amber-600" />
          Clientes no disponibles
        </CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        {reason ? MESSAGES[reason] : failed ? 'No se pudieron cargar los clientes. Intenta de nuevo con Actualizar.' : 'No se pudo leer Odoo.'}
      </CardContent>
    </Card>
  )
}
