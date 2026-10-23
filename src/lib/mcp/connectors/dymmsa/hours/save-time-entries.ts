import { z } from 'zod'
import { defineTool } from '@/lib/mcp/core/define'
import { saveTimeEntries } from '@/lib/mcp/tools/hours'

export const saveTimeEntriesTool = defineTool({
  connector: 'dymmsa',
  name: 'save_time_entries',
  kind: 'write',
  title: 'Guardar checadas',
  description:
    'Escribe checadas, solo si un administrador lo pide. A) `filas`: el reporte semanal del checador, las mismas filas que en preview_time_report (revísalo ahí primero). Si no cuadra con los totales del reporte, no guarda nada. B) `checada`: corrige una (`entrada_actual` = su entrada de hoy, ver get_week_hours) o registra una a mano (con `entrada`); `salida: ""` la borra. Lo corregido sobrevive al re-import.',
  input: {
    filas: z.array(z.array(z.string().max(200)).max(20)).min(1).max(1000).optional(),
    nombre_archivo: z.string().max(200).optional(),
    checada: z
      .object({
        persona: z.string().optional().describe('Default: tú'),
        fecha: z.string().describe('YYYY-MM-DD'),
        entrada_actual: z.string().optional(),
        entrada: z.string().optional().describe('HH:MM'),
        salida: z.string().optional(),
        nota: z.string().max(300).optional(),
      })
      .optional(),
  },
  // Scoped write (#132, #134; ADR-035): same rules as the app's import and dialog.
  annotations: { readOnlyHint: false, openWorldHint: false },
  adminOnly: true,
  docs: {
    module: 'Horas',
    title: 'Guardar checadas',
    example: 'Este es el reporte del checador de la semana, cargalo. / A Tania le falto la salida del miercoles, salio a las 6.',
    limits: 'Carga el reporte (no duplica, no pisa correcciones y no guarda nada si no cuadra con sus totales) o corrige/registra una checada, conservando lo que dijo el checador. No borra checadas.',
  },
  handler: (input, { db, userId }) => saveTimeEntries(db, userId, input),
})
