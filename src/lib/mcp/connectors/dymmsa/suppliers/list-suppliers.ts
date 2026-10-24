import { z } from 'zod'
import { defineTool } from '@/lib/mcp/core/define'
import { limit } from '@/lib/mcp/core/schema'
import { dymmsaRead } from '../shared'
import { listSuppliers } from '@/lib/mcp/tools/suppliers'

export const listSuppliersTool = defineTool({
  connector: 'dymmsa',
  name: 'list_suppliers',
  kind: 'read',
  title: 'Proveedores de menudeo',
  description:
    'Proveedores locales con contacto, plazo de pago (días de crédito; "Contado" si no hay) y las marcas que surten. Filtra por texto (nombre/teléfono/email) o por marca. Úsala para "¿quién me surte SURTEK?" o "¿qué plazo da Perfiles?".',
  input: {
    buscar: z.string().optional().describe('Texto a buscar en nombre, teléfono, whatsapp o email'),
    marca: z.string().optional().describe('Marca que debe surtir, p. ej. "SURTEK"'),
    limit: limit(100, 50).describe('Máx proveedores (default 50)'),
  },
  hints: dymmsaRead,
  docs: {
    module: 'Proveedores',
    title: 'Proveedores de menudeo',
    example: '¿Quien me surte SURTEK y que plazo da?',
  },
  handler: (input, { db }) => listSuppliers(db, input),
})
