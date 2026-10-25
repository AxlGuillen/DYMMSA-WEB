import { z } from 'zod'
import { defineTool, type WritePlan } from '@/lib/mcp/core/define'
import { ToolError } from '@/lib/mcp/core/errors'
import { isoDate } from '@/lib/mcp/core/schema'
import { savePayrollHours } from '@/lib/mcp/tools/payroll'
import { commitCorrectDay, planCorrectDay, type CorrectCarry } from '@/lib/mcp/tools/payroll-write'
import { SHEET_GUIDE } from './sheet-guide'

export const savePayrollHoursTool = defineTool({
  connector: 'dymmsa',
  name: 'save_payroll_hours',
  kind: 'write',
  title: 'Cargar o corregir horas de nómina',
  description:
    'Guarda horas por empleado y día —típicamente la hoja semanal del taller— como BORRADOR, directo. `horas` es el total del día (jornada + extras: 8 + 3.5 = 11.5); el doble de sábado (lo que pasa de 5 h) y el triple de domingo los calcula la app. Nunca pisa un día confirmado, capturado a mano o traído del checador, ni un corte cerrado: vuelven en `omitidos` con el motivo. Con `traer_de_horas: true` (sin `dias`) copia al corte de `fecha` (default el actual) las horas checadas de la oficina y su sábado pagado, como el botón "Traer de Horas". Con `corregir` (solo) cambia UN día ya capturado, también uno confirmado, y lo deja confirmado y manual; `horas: 0` sin nota lo borra; pide el sí con la clave. Confirmar y cerrar el corte es save_payroll_period; no crea empleados. ' +
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
    corregir: z
      .strictObject({
        empleado: z.string().min(1).describe('Nombre (o parte); también uno dado de baja'),
        fecha: isoDate,
        horas: z.number().min(0).max(24).describe('Total del día; 0 sin nota lo borra'),
        horas_no_trabajadas: z.number().min(0).max(24).optional().describe('Omitida = las que tenía'),
        nota: z.string().max(300).optional().describe('Omitida = la que tenía; texto vacío la borra'),
      })
      .optional()
      .describe('Corrige UN día; va solo, sin `dias`'),
  },
  // Renamed from record_payroll_hours (#155 C6). `dias` and `traer_de_horas` stay drafts written directly (#123, ADR-033);
  // only `corregir` asks for the yes. Absolute hours on a (employee, day) key: a repeat is a no-op (#155 C2).
  hints: { destructiveHint: true, idempotentHint: true, openWorldHint: false },
  adminOnly: true,
  confirm: 'two_phase',
  direct: true,
  docs: {
    module: 'Nomina',
    title: 'Cargar o corregir horas de nomina',
    example: 'Esta es la hoja de asistencia de la semana, cargala.',
    evals: ['Esta es la hoja de asistencia de la semana, cárgala.', 'Trae las horas del checador al corte de esta semana.', 'A Pedro el martes ponle 9.5 horas, no 8.'],
    limits: 'Las horas de la hoja y del checador entran como borrador. Corregir un dia ya confirmado pide tu confirmacion. No confirma ni cierra cortes (eso es save_payroll_period), no crea empleados ni maneja montos.',
  },
  plan: async (input, { db }): Promise<WritePlan<CorrectCarry | null>> => {
    if (input.corregir) {
      if (input.dias?.length || input.traer_de_horas || input.fecha !== undefined) {
        throw new ToolError('Una intención por llamada: `corregir` va solo, sin `dias`, `traer_de_horas` ni `fecha`.')
      }
      return planCorrectDay(db, input.corregir)
    }
    // Drafts and the clock's hours are low risk: they write now, and savePayrollHours validates before it does.
    return { entity: { key: 'horas', value: null }, directo: true, fingerprint: null, subject: 'Las horas', carry: null }
  },
  commit: (input, { db }, plan) => (plan.carry ? commitCorrectDay(db, plan as WritePlan<CorrectCarry>) : savePayrollHours(db, input)),
})
