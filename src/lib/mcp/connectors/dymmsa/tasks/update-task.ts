import { z } from 'zod'
import { defineTool } from '@/lib/mcp/core/define'
import { updateTask } from '@/lib/mcp/tools/tasks'

export const updateTaskTool = defineTool({
  connector: 'dymmsa',
  name: 'update_task',
  kind: 'write',
  title: 'Actualizar tarea',
  description:
    'Actualiza una tarea existente (GitHub Issue). ESCRIBE: usa solo cuando el usuario pida comentar, cambiar la prioridad o cerrar/reabrir una tarea. Acepta cualquier combinación de: comment (se publica atribuido a "Asistente (MCP)"), priority (low | medium | high | highest, o "none" para quitarla) y state (open | closed; al cerrar, state_reason "completed" o "not_planned" = descartada). NO edita título ni descripción — eso se hace en la app.',
  input: {
    task_number: z.number().int().min(1).describe('Número de la tarea (#N)'),
    comment: z.string().optional().describe('Comentario a publicar en la tarea'),
    priority: z.string().optional().describe('low | medium | high | highest, o "none" para quitarla'),
    state: z.string().optional().describe('open (reabrir) | closed (cerrar)'),
    state_reason: z.string().optional().describe('Solo al cerrar: completed (default) | not_planned (descartada)'),
  },
  // Scoped write (#72, ADR-015): comment/prioritize/close, never rewrite human text.
  annotations: { readOnlyHint: false, openWorldHint: false },
  docs: {
    module: 'Tareas',
    title: 'Actualizar tarea',
    example: 'Cierra la tarea 45 y comenta que ya quedo.',
    limits: 'Comenta, cambia prioridad, cierra o reabre. Nunca reescribe el titulo ni la descripcion.',
  },
  handler: (input) => updateTask(input),
})
