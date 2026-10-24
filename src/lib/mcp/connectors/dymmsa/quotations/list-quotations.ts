import { z } from 'zod'
import { defineTool } from '@/lib/mcp/core/define'
import { pagination, readOnly } from '@/lib/mcp/core/schema'
import { listQuotations } from '@/lib/mcp/tools/quotations'
import { QUOTATION_STATUSES } from '@/lib/quotation-status'

export const listQuotationsTool = defineTool({
  connector: 'dymmsa',
  name: 'list_quotations',
  kind: 'read',
  title: 'Listar cotizaciones',
  description:
    'Lista cotizaciones con filtros. Úsala para preguntas como "¿qué cotizaciones esperan aprobación?" o buscar por cliente. Nota: total_amount aquí es el monto SELLADO en la fila; en cotizaciones aprobadas editables puede quedar desfasado de los ítems actuales — usa get_quotation para el total recalculado en vivo.',
  input: {
    status: z.enum(QUOTATION_STATUSES).optional().describe('Filtrar por estado exacto'),
    search: z.string().optional().describe('Busca en nombre de cotización y nombre del cliente'),
    ...pagination,
  },
  annotations: readOnly,
  docs: {
    module: 'Cotizaciones',
    title: 'Listar cotizaciones',
    example: '¿Que cotizaciones esperan aprobacion?',
  },
  handler: (input, { db }) => listQuotations(db, input),
})
