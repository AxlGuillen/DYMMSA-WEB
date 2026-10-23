import { z } from 'zod'
import { defineTool } from '@/lib/mcp/core/define'
import { readOnly } from '@/lib/mcp/core/schema'
import { getProfiles } from '@/lib/mcp/tools/profiles'

export const getProfilesTool = defineTool({
  connector: 'dymmsa',
  name: 'get_profiles',
  kind: 'read',
  title: 'Perfiles del equipo',
  description:
    'Perfil de las personas con cuenta en la app: nombre, rol, jornada, id del checador, NSS (Número de Seguridad Social) y foto. Sin `persona` devuelve todos los perfiles que quien pregunta puede ver (un miembro solo el suyo, un administrador a todo el equipo) con el NSS solo de quien pregunta; con `persona` busca a una por nombre parcial e incluye su NSS. Úsala para "¿cuál es mi NSS?" o "¿cuál es el NSS de Tania?".',
  input: {
    persona: z.string().optional().describe('Nombre (o parte) de la persona; solo un administrador ve a otros'),
  },
  annotations: readOnly,
  docs: {
    module: 'Perfil',
    title: 'Perfiles del equipo',
    example: '¿Cual es mi NSS?',
  },
  handler: (input, { db, userId }) => getProfiles(db, userId, input),
})
