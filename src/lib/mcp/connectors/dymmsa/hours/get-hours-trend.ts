import { z } from 'zod'
import { defineTool } from '@/lib/mcp/core/define'
import { dymmsaRead } from '../shared'
import { getHoursTrend } from '@/lib/mcp/tools/hours'

export const getHoursTrendTool = defineTool({
  connector: 'dymmsa',
  name: 'get_hours_trend',
  kind: 'read',
  title: 'Tendencia de horas',
  description:
    'Total de horas por semana de las últimas N semanas (default 8, máx 26) hasta la actual, con el promedio semanal y el cumplimiento de la jornada. Úsala para "¿cómo viene Fulano este mes?" o "¿quién no está completando su jornada?" (una llamada por persona).',
  input: {
    persona: z.string().optional().describe('Nombre (o parte) de la persona; solo un administrador ve a otros'),
    semanas: z.number().int().min(1).max(26).optional().describe('Semanas a incluir (default 8)'),
  },
  hints: dymmsaRead,
  docs: {
    module: 'Horas',
    title: 'Tendencia de horas',
    example: '¿Como viene Tania en las ultimas semanas?',
    evals: ['¿Cómo viene Tania en las últimas semanas?', '¿Cuál es el promedio semanal de Diego?'],
  },
  handler: (input, { db, userId }) => getHoursTrend(db, userId, input),
})
