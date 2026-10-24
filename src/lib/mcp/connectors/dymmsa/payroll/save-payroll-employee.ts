import { z } from 'zod'
import { defineTool } from '@/lib/mcp/core/define'
import { savePayrollEmployee } from '@/lib/mcp/tools/payroll'

export const savePayrollEmployeeTool = defineTool({
  connector: 'dymmsa',
  name: 'save_payroll_employee',
  kind: 'write',
  title: 'Guardar empleado de nómina',
  description:
    'Da de alta un empleado de nómina (la lista propia de Nómina: los del taller no tienen cuenta), o edita uno si mandas empleado (su nombre o parte): nombre, jornada, perfil de la app ligado (para traer sus horas del checador) y activo — la baja es activo=false, nunca se borra. ESCRIBE: úsala solo cuando un administrador lo pida y confirma los datos antes. No toca horas ni cortes.',
  input: {
    empleado: z.string().optional().describe('Empleado a editar (nombre o parte); omítelo para dar de alta'),
    nombre: z.string().optional().describe('Nombre (obligatorio en un alta)'),
    jornada: z.enum(['completa', 'media']).optional().describe('completa = 8 h, media = 4 h (default completa)'),
    perfil: z.string().nullable().optional().describe('Persona de la app a ligar (nombre); null o "" la desliga'),
    activo: z.boolean().optional().describe('false = darlo de baja'),
  },
  // Scoped write (#134, ADR-037): the employee list only; hours and cuts keep their own rules.
  annotations: { readOnlyHint: false, openWorldHint: false },
  adminOnly: true,
  docs: {
    module: 'Nomina',
    title: 'Guardar empleado de nomina',
    example: 'Da de alta a un trabajador nuevo en el taller, medio tiempo.',
    limits: 'Alta, cambios y baja (desactivar, nunca borrar). No toca horas ni cortes.',
  },
  handler: (input, { db, userId }) => savePayrollEmployee(db, userId, input),
})
