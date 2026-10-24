import { z } from 'zod'
import { defineTool } from '@/lib/mcp/core/define'
import { isoDate } from '@/lib/mcp/core/schema'
import { saveExcusedDay } from '@/lib/mcp/tools/hours'

export const saveExcusedDayTool = defineTool({
  connector: 'dymmsa',
  name: 'save_excused_day',
  kind: 'write',
  title: 'Guardar día justificado',
  description:
    'Marca, cambia o quita un día justificado, solo si un administrador lo pide. `feriado`: no pide horas. `salida_autorizada`: cuenta como cumplido con lo trabajado. Sin `persona`, todo el equipo; con ella, solo esa persona. Si ya existe, lo actualiza; `quitar: true` lo borra.',
  input: {
    fecha: isoDate,
    tipo: z.enum(['feriado', 'salida_autorizada']).optional(),
    persona: z.string().optional(),
    nota: z.string().max(200).optional(),
    quitar: z.boolean().optional(),
  },
  // Scoped write (#134, ADR-035).
  annotations: { readOnlyHint: false, openWorldHint: false },
  adminOnly: true,
  docs: {
    module: 'Horas',
    title: 'Guardar dia justificado',
    example: 'El lunes fue feriado.',
    limits: 'Feriados y salidas autorizadas, para el equipo o una persona; marca, cambia o quita.',
  },
  handler: (input, { db, userId }) => saveExcusedDay(db, userId, input),
})
