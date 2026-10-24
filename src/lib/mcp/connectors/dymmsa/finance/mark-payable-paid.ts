import { z } from 'zod'
import { defineTool } from '@/lib/mcp/core/define'
import { isoDate } from '@/lib/mcp/core/schema'
import { markPayablePaid } from '@/lib/mcp/tools/payables'

export const markPayablePaidTool = defineTool({
  connector: 'dymmsa',
  name: 'mark_payable_paid',
  kind: 'write',
  title: 'Marcar factura pagada',
  description:
    'Marca una factura de gasto como PAGADA con su fecha real de pago (default hoy), o la regresa a pendiente (pagada=false). ESCRIBE: usa solo cuando el usuario lo pida ("ya pagué la de Perfiles"); confirma antes cuál factura y con qué fecha. Identifica la factura por id, concepto o proveedor (prefiere las pendientes al marcar pagada); con varias coincidencias devuelve la lista para precisar. Si ya estaba pagada, solo cambia la fecha cuando se indica fecha_pago.',
  input: {
    factura: z.string().min(1).describe('UUID, o parte del concepto / nombre del proveedor'),
    pagada: z.boolean().optional().describe('true = marcar pagada (default); false = regresar a pendiente'),
    fecha_pago: isoDate.optional().describe('Fecha REAL de pago (default hoy)'),
  },
  // Scoped write (#109, ADR-030): a symbolic expense record, not money nor inventory.
  annotations: { readOnlyHint: false, openWorldHint: false },
  docs: {
    module: 'Finanzas',
    title: 'Marcar factura pagada',
    example: 'Ya pague la de Perfiles, marcala.',
    limits: 'Marca pagada con la fecha real o regresa a pendiente. No edita montos ni borra facturas.',
  },
  handler: (input, { db }) => markPayablePaid(db, input),
})
