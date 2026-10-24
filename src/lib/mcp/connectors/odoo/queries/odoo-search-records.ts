import { z } from 'zod'
import { callOdoo } from '@/lib/odoo/client'
import { defineTool } from '@/lib/mcp/core/define'
import { odooSearchRecords } from '@/lib/mcp/tools/odoo/accounting'
import { domainSchema, odooRead } from '../shared'

export const odooSearchRecordsTool = defineTool({
  connector: 'odoo',
  name: 'odoo_search_records',
  kind: 'read',
  title: 'Buscar registros (Odoo)',
  description:
    'Primitiva: lee registros normalizados (máx 50) de un modelo del catálogo permitido de Odoo: facturas y sus líneas, pagos, documentos CFDI/REP, contactos, ventas y sus líneas, productos, existencias, el directorio de empleados (hr.employee) y la flotilla (fleet.vehicle y su bitácora fleet.vehicle.log.services). Úsala solo cuando ninguna tool curada responda: no aplica sus reglas (notas de crédito aparte, solo publicadas o confirmadas, día de Morelia). Para totales, odoo_aggregate_records.',
  input: {
    model: z.string().describe('Modelo Odoo del catálogo, p. ej. "account.move" o "hr.employee"'),
    domain: domainSchema,
    fields: z.array(z.string()).optional().describe('Campos a devolver (subset del catálogo; omite para todos los permitidos)'),
    limit: z.number().int().min(1).max(50).optional().describe('Máx registros (default 20)'),
    order: z.string().optional().describe('Orden, p. ej. "invoice_date desc"'),
    offset: z.number().int().min(0).optional(),
  },
  annotations: odooRead,
  docs: {
    module: 'Consultas libres',
    title: 'Buscar registros en Odoo',
    example: '¿Cual es el correo de trabajo de Diego y que camioneta tiene asignada?',
  },
  handler: (input) => odooSearchRecords(callOdoo, input),
})
