import { z } from 'zod'
import { defineTool } from '@/lib/mcp/core/define'
import { readOnly } from '@/lib/mcp/core/schema'
import { listTimeImports } from '@/lib/mcp/tools/hours'

export const listTimeImportsTool = defineTool({
  connector: 'dymmsa',
  name: 'list_time_imports',
  kind: 'read',
  title: 'Cargas del checador',
  description:
    'Bitácora de los reportes semanales del checador cargados a la app: periodo, archivo, checadas insertadas/actualizadas y las saltadas por edición manual. Solo un administrador ve filas.',
  input: {
    limit: z.number().int().min(1).max(50).optional().describe('Cuántas cargas listar (default 10)'),
  },
  annotations: readOnly,
  adminOnly: true,
  docs: {
    module: 'Horas',
    title: 'Cargas del checador',
    example: '¿Cuando se cargo el ultimo reporte del checador?',
  },
  handler: (input, { db }) => listTimeImports(db, input),
})
