import { callOdoo } from '@/lib/odoo/client'
import { defineTool } from '@/lib/mcp/core/define'
import { readOnly } from '@/lib/mcp/core/schema'
import { odooEmployeeDirectory } from '@/lib/mcp/tools/odoo/operations'

export const odooEmployeeDirectoryTool = defineTool({
  connector: 'odoo',
  name: 'odoo_employee_directory',
  kind: 'read',
  title: 'Directorio de empleados (Odoo)',
  description:
    'Directorio LABORAL del equipo registrado en Odoo (externo): nombre, puesto, departamento y contacto de trabajo. No incluye — por diseño — nómina, salarios ni datos personales.',
  input: {},
  annotations: readOnly,
  docs: {
    module: 'Operacion',
    title: 'Directorio de empleados',
    example: '¿Cual es el correo de trabajo de Diego?',
  },
  handler: () => odooEmployeeDirectory(callOdoo),
})
