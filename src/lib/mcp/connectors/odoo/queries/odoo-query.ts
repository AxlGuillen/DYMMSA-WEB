import { z } from 'zod'
import { callOdoo } from '@/lib/odoo/client'
import { defineTool } from '@/lib/mcp/core/define'
import { readOnly } from '@/lib/mcp/core/schema'
import { odooQuery } from '@/lib/mcp/tools/odoo/accounting'
import { domainSchema } from '../shared'

export const odooQueryTool = defineTool({
  connector: 'odoo',
  name: 'odoo_query',
  kind: 'read',
  title: 'Consulta genérica en Odoo',
  description:
    'Consulta Odoo (el sistema de FACTURACIÓN de la empresa, externo a DYMMSA-WEB) sobre los modelos del catálogo permitido: facturas y sus líneas, pagos, documentos CFDI/REP, contactos, ventas y sus líneas, productos, existencias, empleados (directorio) y flotilla. Úsala para preguntas que las tools curadas no cubran. Devuelve registros normalizados (máx 50). Prefiere odoo_aggregate para totales.',
  input: {
    model: z.string().describe('Modelo Odoo del catálogo, p. ej. "account.move"'),
    domain: domainSchema,
    fields: z.array(z.string()).optional().describe('Campos a devolver (subset del catálogo; omite para todos los permitidos)'),
    limit: z.number().int().min(1).max(50).optional().describe('Máx registros (default 20)'),
    order: z.string().optional().describe('Orden, p. ej. "invoice_date desc"'),
    offset: z.number().int().min(0).optional(),
  },
  annotations: readOnly,
  docs: {
    module: 'Consultas libres',
    title: 'Consulta generica en Odoo',
    example: 'Facturas de GE de agosto con su estado de pago.',
  },
  handler: (input) => odooQuery(callOdoo, input),
})
