import { z } from 'zod'
import { defineTool } from '@/lib/mcp/core/define'
import { isoDate } from '@/lib/mcp/core/schema'
import { EXCUSE_TOKENS } from '@/lib/timesheet'
import { saveExcusedDay } from '@/lib/mcp/tools/hours'

export const saveExcusedDayTool = defineTool({
  connector: 'dymmsa',
  name: 'save_excused_day',
  kind: 'write',
  title: 'Guardar día justificado',
  description:
    'Marca o cambia un día justificado, solo si un administrador lo pide. `feriado`: no pide horas. `salida_autorizada`: cuenta como cumplido con lo trabajado. Sin `persona`, todo el equipo; con ella, solo esa persona. Si ya existe, lo actualiza. Quitar uno es delete_record.',
  input: {
    fecha: isoDate,
    tipo: z.enum(EXCUSE_TOKENS.tokens).optional().describe('Obligatorio en uno nuevo'),
    persona: z.string().optional().describe('Nombre (o parte) o ref; omitida = todo el equipo'),
    nota: z.string().max(200).optional(),
  },
  // Scoped write (#134, ADR-035). It no longer removes (delete_record does); UNIQUE (fecha, persona) makes a repeat a no-op (#155 C2, C6).
  hints: { destructiveHint: true, idempotentHint: true, openWorldHint: false },
  adminOnly: true,
  docs: {
    module: 'Horas',
    title: 'Guardar dia justificado',
    example: 'El lunes fue feriado.',
    evals: ['El lunes fue feriado para todos.', 'Diego tuvo salida autorizada el jueves.'],
    limits: 'Feriados y salidas autorizadas, para el equipo o una persona; marca o cambia. No los quita (delete_record).',
  },
  handler: (input, { db, userId }) => saveExcusedDay(db, userId, input),
})
