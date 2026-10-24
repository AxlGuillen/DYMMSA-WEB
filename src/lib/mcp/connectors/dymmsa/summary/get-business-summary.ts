import { defineTool } from '@/lib/mcp/core/define'
import { readOnly } from '@/lib/mcp/core/schema'
import { getBusinessSummary } from '@/lib/mcp/tools/summary'

export const getBusinessSummaryTool = defineTool({
  connector: 'dymmsa',
  name: 'get_business_summary',
  kind: 'read',
  title: 'Resumen del negocio',
  description:
    'Panorama general de DYMMSA en una llamada: cotizaciones por estado, órdenes por estado, salud del inventario, tamaño de catálogos y tareas abiertas. Úsala primero cuando pregunten "¿cómo vamos?" o necesites contexto global.',
  input: {},
  annotations: readOnly,
  docs: {
    module: 'Panorama',
    title: 'Resumen del negocio',
    example: '¿Como vamos? Dame el panorama general.',
  },
  handler: (_input, { db }) => getBusinessSummary(db),
})
