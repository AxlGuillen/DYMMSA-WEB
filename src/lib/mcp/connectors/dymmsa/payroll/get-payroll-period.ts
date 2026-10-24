import { defineTool } from '@/lib/mcp/core/define'
import { isoDate, readOnly } from '@/lib/mcp/core/schema'
import { getPayrollPeriod } from '@/lib/mcp/tools/payroll'

export const getPayrollPeriodTool = defineTool({
  connector: 'dymmsa',
  name: 'get_payroll_period',
  kind: 'read',
  title: 'Corte de nómina',
  description:
    'Horas de nómina del corte sábado→viernes que contiene `fecha` (default: el corte actual): por empleado, cada día con sus horas, si es borrador o confirmado y de dónde salió (hoja, checador, manual), más los totales normal / extra / sábado extra (×2) / domingo (×3) y el equivalente. Solo los días confirmados suman. SOLO administradores: a un miembro le llega vacío. Son horas, no montos.',
  input: {
    fecha: isoDate.optional().describe('Cualquier día del corte (default hoy)'),
  },
  annotations: readOnly,
  adminOnly: true,
  docs: {
    module: 'Nomina',
    title: 'Corte de nomina',
    example: '¿Cuantas horas lleva cada quien en el corte de esta semana?',
  },
  handler: (input, { db }) => getPayrollPeriod(db, input),
})
