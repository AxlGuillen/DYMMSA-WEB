import { z } from 'zod'
import { callOdoo } from '@/lib/odoo/client'
import { defineTool } from '@/lib/mcp/core/define'
import { limit } from '@/lib/mcp/core/schema'
import { odooSearchRecords } from '@/lib/mcp/tools/odoo/accounting'
import { domainSchema, odooRead } from '../shared'

export const odooSearchRecordsTool = defineTool({
  connector: 'odoo',
  name: 'odoo_search_records',
  kind: 'read',
  title: 'Buscar registros (Odoo)',
  description:
    'Primitiva: lee registros normalizados (máx 50) de un modelo del catálogo permitido de Odoo: facturas y sus líneas, pagos, documentos CFDI/REP, contactos, ventas y sus líneas, productos, existencias, las claves SAT (product.unspsc.code), el directorio de empleados (hr.employee) y la flotilla (fleet.vehicle y su bitácora fleet.vehicle.log.services). Úsala solo cuando ninguna tool curada responda: no aplica sus reglas (notas de crédito aparte, solo publicadas o confirmadas, día de Morelia). Para totales, odoo_aggregate_records.',
  input: {
    modelo: z.string().describe('Modelo Odoo del catálogo, p. ej. "account.move" o "hr.employee"'),
    filtros: domainSchema,
    campos: z.array(z.string()).optional().describe('Campos a devolver (subset del catálogo; omite para todos los permitidos)'),
    limite: limit(50, 20),
    orden: z.string().optional().describe('P. ej. "invoice_date desc"'),
    saltar: z.number().int().min(0).optional().describe('Registros a saltar (paginar)'),
  },
  annotations: odooRead,
  docs: {
    module: 'Consultas libres',
    title: 'Buscar registros en Odoo',
    example: '¿Cual es el correo de trabajo de Diego y que camioneta tiene asignada?',
  },
  handler: (input) => odooSearchRecords(callOdoo, input),
})
