import { z } from 'zod'
import { defineTool } from '@/lib/mcp/core/define'
import { TASK_CLOSE_REASONS, TASK_PRIORITIES, TASK_STATES } from '@/lib/github'
import { updateTask } from '@/lib/mcp/tools/tasks'

export const updateTaskTool = defineTool({
  connector: 'dymmsa',
  name: 'update_task',
  kind: 'write',
  title: 'Actualizar tarea',
  description:
    'Actualiza una tarea existente (GitHub Issue). ESCRIBE: usa solo cuando el usuario pida comentar, cambiar la prioridad o cerrar/reabrir una tarea. Acepta cualquier combinación de: comment (se publica atribuido a "Asistente (MCP)"), priority ("none" la quita) y state (al cerrar, state_reason not_planned = descartada). NO edita título ni descripción — eso se hace en la app.',
  input: {
    task_number: z.number().int().min(1).describe('Número de la tarea (#N)'),
    comment: z.string().optional().describe('Comentario a publicar en la tarea'),
    priority: z.enum([...TASK_PRIORITIES, 'none']).optional().describe('"none" la quita'),
    state: z.enum(TASK_STATES).optional().describe('open reabre, closed cierra'),
    state_reason: z.enum(TASK_CLOSE_REASONS).optional().describe('Solo al cerrar (default completed); not_planned = descartada'),
  },
  // Scoped write (#72, ADR-015): comment/prioritize/close, never rewrite human text.
  // Priority and state overwrite, and each comment is a new one: not idempotent (#155 C2).
  hints: { destructiveHint: true, idempotentHint: false, openWorldHint: false },
  docs: {
    module: 'Tareas',
    title: 'Actualizar tarea',
    example: 'Cierra la tarea 45 y comenta que ya quedo.',
    limits: 'Comenta, cambia prioridad, cierra o reabre. Nunca reescribe el titulo ni la descripcion.',
  },
  handler: (input) => updateTask(input),
})
