import { z } from 'zod'
import { defineTool } from '@/lib/mcp/core/define'
import { isoDate } from '@/lib/mcp/core/schema'
import { savePayrollHours } from '@/lib/mcp/tools/payroll'
import { SHEET_GUIDE } from './sheet-guide'

export const savePayrollHoursTool = defineTool({
  connector: 'dymmsa',
  name: 'save_payroll_hours',
  kind: 'write',
  title: 'Cargar horas de nómina (borrador)',
  description:
    'Guarda horas trabajadas por empleado y día como BORRADOR — típicamente lo leído de la hoja semanal de asistencia del taller. Úsala solo cuando un administrador lo pida y después de mostrarle lo que leíste y recibir su confirmación. `horas` es el total trabajado ese día (jornada + extras: 8 + 3.5 = 11.5); el doble de sábado (lo que pasa de 5 h) y el triple de domingo los calcula la app, no los multipliques. Nunca pisa un día ya confirmado, capturado a mano o traído del checador, ni toca un corte cerrado: esos vuelven en `omitidos` con el motivo. No confirma, no cierra cortes y no crea empleados. Con `traer_de_horas: true` (sin `dias`) copia al corte que contiene `fecha` (default el actual) las horas checadas de la oficina y su sábado pagado (8 h, 4 a medio tiempo), como el botón "Traer de Horas". ' +
    SHEET_GUIDE,
  input: {
    dias: z
      .array(
        z.strictObject({
          empleado: z.string().min(1).describe('Nombre (o parte) del empleado de nómina'),
          fecha: isoDate.describe('Día trabajado'),
          horas: z.number().min(0).max(24).describe('Horas trabajadas ese día, con decimales (11.5)'),
          horas_no_trabajadas: z.number().min(0).max(24).optional().describe('HRS NO TRABAJADAS de ese día (solo registro)'),
          nota: z.string().max(300).optional().describe('Nota del día'),
        }),
      )
      .min(1)
      .max(200)
      .optional()
      .describe('Un elemento por empleado y día (la hoja del taller)'),
    traer_de_horas: z.boolean().optional(),
    fecha: isoDate.optional(),
  },
  // Renamed from record_payroll_hours (#155 C6). Scoped write (#123, ADR-033): drafts only; the admin confirms in the app.
  // It overwrites its own drafts with absolute hours: a repeat is a no-op (#155 C2).
  hints: { destructiveHint: true, idempotentHint: true, openWorldHint: false },
  adminOnly: true,
  docs: {
    module: 'Nomina',
    title: 'Cargar horas de nomina',
    example: 'Esta es la hoja de asistencia de la semana, cargala.',
    limits: 'Solo borradores: no confirma, no cierra cortes, no pisa lo ya confirmado ni crea empleados. Tambien trae las horas del checador de la oficina, como el boton Traer de Horas.',
  },
  handler: (input, { db }) => savePayrollHours(db, input),
})
