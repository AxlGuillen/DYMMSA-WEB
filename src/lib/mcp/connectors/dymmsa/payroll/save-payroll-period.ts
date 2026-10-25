import { z } from 'zod'
import { defineTool } from '@/lib/mcp/core/define'
import { isoDate } from '@/lib/mcp/core/schema'
import { commitSavePayrollPeriod, PERIOD_ACTIONS, planSavePayrollPeriod } from '@/lib/mcp/tools/payroll-write'

export const savePayrollPeriodTool = defineTool({
  connector: 'dymmsa',
  name: 'save_payroll_period',
  kind: 'write',
  title: 'Confirmar o cerrar corte de nómina',
  description:
    'Confirma los borradores, cierra o reabre el corte de nómina (sábado→viernes) que contiene `fecha` (default el actual). Úsala para "confirma los borradores" o "cierra el corte". Siempre pide el sí con la clave: el resumen lista cada día que pasa a ser horas pagables y la clave queda atada a ese conjunto exacto. Cerrar exige cero borradores; reabrir descongela un corte posiblemente pagado. Son horas, nunca montos.',
  input: {
    accion: z.enum(PERIOD_ACTIONS),
    fecha: isoDate.optional().describe('Cualquier día del corte (default hoy)'),
  },
  // Re-closing a closed cut and re-confirming nothing are no-ops since #157: the same call changes nothing more.
  hints: { destructiveHint: true, idempotentHint: true, openWorldHint: false },
  adminOnly: true,
  confirm: 'two_phase',
  docs: {
    module: 'Nomina',
    title: 'Confirmar o cerrar corte de nomina',
    example: 'Confirma los borradores de esta semana y cierra el corte.',
    evals: ['Confirma los borradores de esta semana.', 'Cierra el corte del viernes.'],
    limits: 'Confirma borradores, cierra o reabre un corte; siempre pide tu confirmacion y muestra cada dia que pasa a ser horas pagables. Son horas, nunca montos; no crea empleados.',
  },
  plan: (input, { db }) => planSavePayrollPeriod(db, input),
  commit: (_input, { db, userId }, plan) => commitSavePayrollPeriod(db, userId, plan),
})
