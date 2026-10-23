import { z } from 'zod'
import { defineTool } from '@/lib/mcp/core/define'
import { createTask } from '@/lib/mcp/tools/tasks'

export const createTaskTool = defineTool({
  connector: 'dymmsa',
  name: 'create_task',
  kind: 'write',
  title: 'Crear tarea',
  description:
    'Crea una tarea nueva (GitHub Issue del repo). ESCRIBE: usa solo cuando el usuario pida registrar una tarea/pendiente. title es obligatorio; description opcional; priority opcional (low | medium | high | highest). La tarea queda como reportada por "Asistente (MCP)". Devuelve la tarea creada con su número (#N) y URL.',
  input: {
    title: z.string().min(1).describe('Título de la tarea (obligatorio)'),
    description: z.string().optional().describe('Descripción/detalle de la tarea'),
    priority: z.string().optional().describe('low | medium | high | highest'),
  },
  // Write (ADR-015 phase 2): no readOnlyHint on purpose.
  annotations: { readOnlyHint: false, openWorldHint: false },
  docs: {
    module: 'Tareas',
    title: 'Crear tarea',
    example: 'Registra una tarea: revisar los precios de Truper.',
    limits: 'Queda reportada por el asistente.',
  },
  handler: (input) => createTask(input),
})
