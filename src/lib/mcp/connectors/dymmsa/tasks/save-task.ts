import { z } from 'zod'
import { defineTool } from '@/lib/mcp/core/define'
import { TASK_CLOSE_REASON_TOKENS, TASK_PRIORITY_TOKENS, TASK_STATE_TOKENS } from '@/lib/github'
import { commitSaveTask, planSaveTask } from '@/lib/mcp/tools/tasks'

export const saveTaskTool = defineTool({
  connector: 'dymmsa',
  name: 'save_task',
  kind: 'write',
  title: 'Guardar tarea',
  description:
    'Crea una tarea (GitHub Issue) o cambia una existente con `tarea`: comentar, priorizar, cerrar o reabrir. Sin `tarea`, `titulo` es obligatorio. Directo; cambiar el título o la descripción de una tarea existente pide el sí con la clave. La tarea queda reportada por el asistente; un comentario se publica atribuido a él. Cerrar con motivo descartada = no se hará.',
  input: {
    tarea: z.number().int().min(1).optional().describe('Número (#N) de la existente; omítelo para crear'),
    titulo: z.string().optional().describe('Obligatorio al crear'),
    descripcion: z.string().optional(),
    prioridad: z.enum([...TASK_PRIORITY_TOKENS.tokens, 'ninguna']).optional().describe('"ninguna" la quita'),
    estado: z.enum(TASK_STATE_TOKENS.tokens).optional().describe('abierta reabre, cerrada cierra'),
    motivo: z.enum(TASK_CLOSE_REASON_TOKENS.tokens).optional().describe('Solo al cerrar (default completada)'),
    comentario: z.string().optional().describe('Comentario a publicar en la tarea'),
  },
  // Replaces create_task and update_task (#155 C6). Creating only adds, but a priority or state overwrite and each
  // comment is a new one: the merged tool is E(1,0) (Auditoría DYMMSA-WEB §3, resolución 4).
  hints: { destructiveHint: true, idempotentHint: false, openWorldHint: false },
  confirm: 'two_phase',
  direct: true,
  docs: {
    module: 'Tareas',
    title: 'Guardar tarea',
    example: 'Registra una tarea: revisar los precios de Truper. / Cierra la tarea 45 y comenta que ya quedo.',
    limits: 'Crea, comenta, prioriza, cierra o reabre. Cambiar el título o la descripción pide tu confirmación. La tarea y los comentarios quedan atribuidos al asistente.',
  },
  plan: (input) => planSaveTask(input),
  commit: (_input, _ctx, plan) => commitSaveTask(plan),
})
