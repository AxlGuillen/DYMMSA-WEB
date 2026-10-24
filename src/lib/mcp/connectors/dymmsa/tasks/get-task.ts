import { z } from 'zod'
import { defineTool } from '@/lib/mcp/core/define'
import { readOnly } from '@/lib/mcp/core/schema'
import { getTask } from '@/lib/mcp/tools/tasks'

export const getTaskTool = defineTool({
  connector: 'dymmsa',
  name: 'get_task',
  kind: 'read',
  title: 'Detalle de tarea',
  description: 'Una tarea con su descripción, quién la reportó, prioridad, estado y todos sus comentarios.',
  input: { number: z.number().int().min(1).describe('Número de la tarea (#N)') },
  annotations: readOnly,
  docs: {
    module: 'Tareas',
    title: 'Detalle de tarea',
    example: '¿Que dice la tarea 45?',
  },
  handler: ({ number }) => getTask(number),
})
