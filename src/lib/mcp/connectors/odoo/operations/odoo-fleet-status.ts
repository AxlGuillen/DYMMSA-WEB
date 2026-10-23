import { callOdoo } from '@/lib/odoo/client'
import { defineTool } from '@/lib/mcp/core/define'
import { readOnly } from '@/lib/mcp/core/schema'
import { odooFleetStatus } from '@/lib/mcp/tools/odoo/operations'

export const odooFleetStatusTool = defineTool({
  connector: 'odoo',
  name: 'odoo_fleet_status',
  kind: 'read',
  title: 'Estado de la flotilla (Odoo)',
  description:
    'La flotilla registrada en Odoo (externo): vehículos con placas, conductor asignado, odómetro y estado, más los últimos servicios/mantenimientos de la bitácora.',
  input: {},
  annotations: readOnly,
  docs: {
    module: 'Operacion',
    title: 'Estado de la flotilla',
    example: '¿Que vehiculos tienen servicio reciente?',
  },
  handler: () => odooFleetStatus(callOdoo),
})
