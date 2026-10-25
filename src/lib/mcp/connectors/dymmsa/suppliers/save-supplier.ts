import { z } from 'zod'
import { defineTool } from '@/lib/mcp/core/define'
import { saveSupplier } from '@/lib/mcp/tools/suppliers'

export const saveSupplierTool = defineTool({
  connector: 'dymmsa',
  name: 'save_supplier',
  kind: 'write',
  title: 'Guardar proveedor',
  description:
    'Da de alta un proveedor de menudeo, o edita uno existente si mandas proveedor (su nombre o parte): contacto, días de crédito (null = contado) y marcas que surte con agregar_marcas / quitar_marcas (deben existir en el catálogo de marcas). Un texto vacío borra ese dato. ESCRIBE: confirma los datos antes. No borra proveedores.',
  input: {
    proveedor: z.string().optional().describe('Proveedor a editar (nombre o parte); omítelo para dar de alta'),
    nombre: z.string().optional().describe('Nombre (obligatorio en un alta)'),
    telefono: z.string().optional(),
    whatsapp: z.string().optional(),
    email: z.string().optional(),
    direccion: z.string().optional(),
    notas: z.string().optional(),
    dias_credito: z.number().int().min(0).max(9999).nullable().optional().describe('Días de crédito; null = contado'),
    agregar_marcas: z.array(z.string()).optional().describe('Marcas que surte, p. ej. ["SURTEK"]'),
    quitar_marcas: z.array(z.string()).optional(),
  },
  // Scoped write (#134, ADR-037): contact data and brand links; deleting stays in the app.
  // An edit overwrites and quitar_marcas unlinks; the name is UNIQUE, so a repeat adds nothing (#155 C2).
  hints: { destructiveHint: true, idempotentHint: true, openWorldHint: false },
  docs: {
    module: 'Proveedores',
    title: 'Guardar proveedor',
    example: 'Da de alta a Tornillos MX, 30 dias de credito, surte SURTEK.',
    evals: ['Da de alta a Tornillos MX con 30 días de crédito y que surta SURTEK.', 'Cámbiale el teléfono a Perfiles del Bajío.'],
    limits: 'Alta o edicion de contacto, dias de credito y marcas ya registradas. No borra proveedores ni crea marcas.',
  },
  handler: (input, { db }) => saveSupplier(db, input),
})
