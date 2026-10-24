import { z } from 'zod'
import { defineTool, type ToolView } from '@/lib/mcp/core/define'
import { dymmsaRead } from '../shared'
import { previewTimeReport, previewTimeReportOutput } from '@/lib/mcp/tools/hours'
import { MCP_VIEWS } from '@/lib/mcp/views/generated'

const TIME_REPORT_VIEW: ToolView = {
  uri: 'ui://dymmsa/time-report.html',
  name: 'Vista: reporte del checador',
  description: 'Tabla del reporte del checador con botón para guardarlo',
  html: () => MCP_VIEWS['time-report'].html,
}

export const previewTimeReportTool = defineTool({
  connector: 'dymmsa',
  name: 'preview_time_report',
  kind: 'read',
  title: 'Revisar reporte del checador',
  description:
    'Revisa SIN guardar el reporte semanal del checador (NGTeco .xls) contra sus propios totales; devuelve la `clave` que save_time_entries exige con `filas` (en Claude se ve como tabla con botón para guardar). `filas`: TODAS las filas tal cual, cada celda en su columna ("" si vacía; sin resumir), con "Período de pago", "Empleado", continuaciones y "Horas totales". Ej.: ["LU","2026-09-28","10:09","19:48","09:38","09:38"].',
  input: {
    filas: z.array(z.array(z.string().max(200)).max(20)).min(1).max(1000),
    nombre_archivo: z.string().max(200).optional(),
  },
  output: previewTimeReportOutput,
  hints: dymmsaRead,
  adminOnly: true,
  view: TIME_REPORT_VIEW,
  docs: {
    module: 'Horas',
    title: 'Revisar reporte del checador',
    example: 'Revisa el reporte del checador de esta semana antes de cargarlo.',
    evals: ['Revisa el reporte del checador de esta semana antes de cargarlo.', '¿Cuadra este reporte con sus propios totales?'],
  },
  handler: (input, { db, userId }) => previewTimeReport(db, userId, input),
})
