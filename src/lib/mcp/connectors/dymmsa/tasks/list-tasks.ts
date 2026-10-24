import { z } from 'zod'
import { defineTool } from '@/lib/mcp/core/define'
import { readOnly } from '@/lib/mcp/core/schema'
import { listTasks } from '@/lib/mcp/tools/tasks'

export const listTasksTool = defineTool({
  connector: 'dymmsa',
  name: 'list_tasks',
  kind: 'read',
  title: 'Listar tareas',
  description:
    'Tareas del equipo (GitHub Issues del repo). state: open | closed | all (default open). priority: low | medium | high | highest. Las cerradas incluyen si se completaron o se descartaron.',
  input: {
    state: z.string().optional().describe('open | closed | all'),
    priority: z.string().optional().describe('low | medium | high | highest'),
    page: z.number().int().min(1).optional().describe('Página (30 por página)'),
  },
  annotations: readOnly,
  docs: {
    module: 'Tareas',
    title: 'Listar tareas',
    example: '¿Que tareas siguen abiertas?',
  },
  handler: (input) => listTasks(input),
})
