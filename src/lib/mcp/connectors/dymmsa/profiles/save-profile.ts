import { z } from 'zod'
import { defineTool } from '@/lib/mcp/core/define'
import { AREA_TOKENS } from '@/lib/profile'
import { SHIFT_TOKENS } from '@/lib/timesheet'
import { commitSaveProfile, planSaveProfile } from '@/lib/mcp/tools/profiles-write'

export const saveProfileTool = defineTool({
  connector: 'dymmsa',
  name: 'save_profile',
  kind: 'write',
  title: 'Guardar perfil',
  description:
    'Cambia el perfil de una persona del equipo: nombre, NSS, id del checador, jornada o área. Sin `persona` es el tuyo. Úsala para "Diego pasa a medio tiempo" o "mi NSS es …". Tu nombre y tu NSS se guardan directo; todo lo de otra persona, y el id del checador, la jornada y el área, piden el sí con la clave. Nunca cambia el rol ni la tarifa; el NSS vuelve enmascarado. No da de alta ni borra personas.',
  input: {
    persona: z.string().optional().describe('Nombre (o parte) o ref; omitida = tú'),
    nombre: z.string().optional(),
    nss: z.string().optional().describe('11 dígitos; texto vacío lo borra'),
    id_checador: z.number().int().min(1).max(99999).nullable().optional().describe('Id del checador; null = no checa'),
    jornada: z.enum([...SHIFT_TOKENS.tokens, 'ninguna']).optional(),
    area: z.enum(AREA_TOKENS.tokens).optional(),
  },
  // Absolute values on a person's own columns: repeating a call changes nothing more.
  hints: { destructiveHint: true, idempotentHint: true, openWorldHint: false },
  adminOnly: true,
  confirm: 'two_phase',
  direct: true,
  docs: {
    module: 'Perfil',
    title: 'Guardar perfil',
    example: 'Diego pasa a medio tiempo / Mi NSS es 1234 56 7890 1.',
    evals: ['Diego pasa a medio tiempo y su NSS es 1234 56 7890 1.', 'Tania va a checar con el id 7.'],
    limits: 'Nombre, NSS, id del checador, jornada y area. Tu nombre y tu NSS se guardan directo; lo demas pide tu confirmacion. Nunca cambia el rol ni la tarifa por hora, ni da de alta o borra personas.',
  },
  plan: (input, { db, userId }) => planSaveProfile(db, userId, input),
  commit: (_input, { db }, plan) => commitSaveProfile(db, plan),
})
