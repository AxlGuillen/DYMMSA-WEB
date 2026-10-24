import { z } from 'zod'
import { defineTool } from '@/lib/mcp/core/define'
import { page } from '@/lib/mcp/core/schema'
import { dymmsaRead } from '../shared'
import { TASK_PRIORITIES } from '@/lib/github'
import { listTasks, TASK_LIST_STATES } from '@/lib/mcp/tools/tasks'

export const listTasksTool = defineTool({
  connector: 'dymmsa',
  name: 'list_tasks',
  kind: 'read',
  title: 'Listar tareas',
  description:
    'Tareas del equipo (GitHub Issues del repo), abiertas por default. Las cerradas incluyen si se completaron o se descartaron.',
  input: {
    state: z.enum(TASK_LIST_STATES).optional().describe('Default open'),
    priority: z.enum(TASK_PRIORITIES).optional(),
    page: page('30 por página'),
  },
  hints: dymmsaRead,
  docs: {
    module: 'Tareas',
    title: 'Listar tareas',
    example: '¿Que tareas siguen abiertas?',
  },
  handler: (input) => listTasks(input),
})
