import { z } from 'zod'
import { defineTool } from '@/lib/mcp/core/define'
import { dymmsaRead } from '../shared'
import { getTask } from '@/lib/mcp/tools/tasks'

export const getTaskTool = defineTool({
  connector: 'dymmsa',
  name: 'get_task',
  kind: 'read',
  title: 'Detalle de tarea',
  description: 'Una tarea con su descripción, quién la reportó, prioridad, estado y sus comentarios (hasta 100).',
  input: { tarea: z.number().int().min(1).describe('Número de la tarea (#N)') },
  hints: dymmsaRead,
  docs: {
    module: 'Tareas',
    title: 'Detalle de tarea',
    example: '¿Que dice la tarea 45?',
    evals: ['¿Qué dice la tarea 45?', '¿Quién comentó en la tarea 45?'],
  },
  handler: ({ tarea }) => getTask(tarea),
})
