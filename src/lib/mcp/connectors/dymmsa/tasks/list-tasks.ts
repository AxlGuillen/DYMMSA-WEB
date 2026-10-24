import { z } from 'zod'
import { defineTool } from '@/lib/mcp/core/define'
import { page } from '@/lib/mcp/core/schema'
import { dymmsaRead } from '../shared'
import { TASK_PRIORITY_TOKENS } from '@/lib/github'
import { listTasks, TASK_LIST_STATES } from '@/lib/mcp/tools/tasks'

export const listTasksTool = defineTool({
  connector: 'dymmsa',
  name: 'list_tasks',
  kind: 'read',
  title: 'Listar tareas',
  description:
    'Tareas del equipo (GitHub Issues del repo), abiertas por default, de la más reciente a la más antigua, con un extracto de la descripción (get_task trae el texto completo). Las cerradas dicen si se completaron o se descartaron.',
  input: {
    estado: z.enum(TASK_LIST_STATES).optional().describe('Default abierta'),
    prioridad: z.enum(TASK_PRIORITY_TOKENS.tokens).optional(),
    pagina: page('30 por página'),
  },
  hints: dymmsaRead,
  docs: {
    module: 'Tareas',
    title: 'Listar tareas',
    example: '¿Que tareas siguen abiertas?',
    evals: ['¿Qué tareas altas siguen abiertas?', '¿Qué tareas se descartaron este mes?'],
  },
  handler: (input) => listTasks(input),
})
