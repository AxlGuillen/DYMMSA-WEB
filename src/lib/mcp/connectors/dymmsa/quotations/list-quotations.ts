import { z } from 'zod'
import { defineTool } from '@/lib/mcp/core/define'
import { pagination } from '@/lib/mcp/core/schema'
import { dymmsaRead } from '../shared'
import { listQuotations } from '@/lib/mcp/tools/quotations'
import { QUOTATION_STATUS_TOKENS } from '@/lib/quotation-status'

export const listQuotationsTool = defineTool({
  connector: 'dymmsa',
  name: 'list_quotations',
  kind: 'read',
  title: 'Listar cotizaciones',
  description:
    'Lista cotizaciones con filtros, de la más reciente a la más antigua. Úsala para "¿qué cotizaciones esperan aprobación?" o buscar por cliente. `total_sellado` es el monto guardado en la fila: en una aprobada editable puede quedar desfasado; get_quotation trae el total recalculado.',
  input: {
    estado: z.enum(QUOTATION_STATUS_TOKENS.tokens).optional().describe('Filtrar por estado exacto'),
    buscar: z.string().optional().describe('Busca en nombre de cotización y nombre del cliente'),
    ...pagination,
  },
  hints: dymmsaRead,
  docs: {
    module: 'Cotizaciones',
    title: 'Listar cotizaciones',
    example: '¿Que cotizaciones esperan aprobacion?',
  },
  handler: (input, { db }) => listQuotations(db, input),
})
