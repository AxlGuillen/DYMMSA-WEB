import { z } from 'zod'
import { defineTool } from '@/lib/mcp/core/define'
import { dymmsaRead } from '../shared'
import { listProfiles } from '@/lib/mcp/tools/profiles'

export const listProfilesTool = defineTool({
  connector: 'dymmsa',
  name: 'list_profiles',
  kind: 'read',
  title: 'Perfiles del equipo',
  description:
    'Perfil de las personas con cuenta en la app: nombre, rol, área, jornada, id del checador, NSS (Número de Seguridad Social) y foto. Sin `persona` devuelve todos los que quien pregunta puede ver (un miembro solo el suyo, un administrador a todo el equipo) con el NSS solo de quien pregunta; con `persona` (nombre parcial o ref) trae a una e incluye su NSS. Úsala para "¿cuál es mi NSS?" o "¿cuál es el NSS de Tania?".',
  input: {
    persona: z.string().optional().describe('Nombre (o parte) o ref; solo un administrador ve a otros'),
  },
  hints: dymmsaRead,
  docs: {
    module: 'Perfil',
    title: 'Perfiles del equipo',
    example: '¿Cual es mi NSS?',
    evals: ['¿Cuál es mi NSS?', '¿Qué jornada tiene Diego y cuál es su id del checador?'],
  },
  handler: (input, { db, userId }) => listProfiles(db, userId, input),
})
