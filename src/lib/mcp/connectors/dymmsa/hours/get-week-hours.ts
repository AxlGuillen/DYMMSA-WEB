import { z } from 'zod'
import { defineTool } from '@/lib/mcp/core/define'
import { readOnly } from '@/lib/mcp/core/schema'
import { getWeekHours } from '@/lib/mcp/tools/hours'

export const getWeekHoursTool = defineTool({
  connector: 'dymmsa',
  name: 'get_week_hours',
  kind: 'read',
  title: 'Horas de la semana',
  description:
    'Horas trabajadas de una semana según el checador, día por día (cada uno con su estado: cumplió, no cumplió, justificado), con el total y el cumplimiento de la jornada (tiempo completo 40 h / medio tiempo 20 h, descontando días feriados y salidas autorizadas por el administrador). Sin `persona` son las horas de quien pregunta; un administrador puede indicar a alguien por nombre parcial. `fecha` = cualquier día de la semana deseada (default: esta semana). Una "checada sin salida" no suma horas.',
  input: {
    persona: z.string().optional().describe('Nombre (o parte) de la persona; solo un administrador ve a otros'),
    fecha: z.string().optional().describe('Cualquier día de la semana, YYYY-MM-DD (default hoy)'),
  },
  annotations: readOnly,
  docs: {
    module: 'Horas',
    title: 'Horas de la semana',
    example: '¿Cuantas horas llevo esta semana?',
  },
  handler: (input, { db, userId }) => getWeekHours(db, userId, input),
})
