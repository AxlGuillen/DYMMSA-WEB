import { defineTool } from '@/lib/mcp/core/define'
import { limit } from '@/lib/mcp/core/schema'
import { dymmsaRead } from '../shared'
import { listTimeImports } from '@/lib/mcp/tools/hours'

export const listTimeImportsTool = defineTool({
  connector: 'dymmsa',
  name: 'list_time_imports',
  kind: 'read',
  title: 'Cargas del checador',
  description:
    'Bitácora de los reportes semanales del checador cargados a la app: periodo, archivo, checadas insertadas/actualizadas y las saltadas por edición manual. Solo un administrador ve filas.',
  input: {
    limit: limit(50, 10, 'cargas'),
  },
  hints: dymmsaRead,
  adminOnly: true,
  docs: {
    module: 'Horas',
    title: 'Cargas del checador',
    example: '¿Cuando se cargo el ultimo reporte del checador?',
  },
  handler: (input, { db }) => listTimeImports(db, input),
})
