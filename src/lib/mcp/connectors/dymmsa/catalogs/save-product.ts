import { z } from 'zod'
import { defineTool } from '@/lib/mcp/core/define'
import { commitSaveProduct, planSaveProduct } from '@/lib/mcp/tools/products-write'
import { SOLD_TOKENS } from '@/lib/tokens'

export const saveProductTool = defineTool({
  connector: 'dymmsa',
  name: 'save_product',
  kind: 'write',
  title: 'Guardar producto ETM',
  description:
    'Alta o cambio de un producto del catálogo ETM: precio, se_vende, descripciones, código, marca o ETM. Con `crear: true` lo da de alta (`etm: "nuevo"` toma el siguiente DYMMSA-N). Úsala para "el 1180234 no lo vendemos" o "en realidad es SURTEK". Directo, salvo `nuevo_etm`, `codigo_modelo` o `marca` (mueven el cruce con el catálogo URREA): esos piden el sí con la clave. La descripción oficial del catálogo nunca se copia como curada. No borra ni importa.',
  input: {
    etm: z.string().describe('ETM exacto o ref; con `crear`, el ETM nuevo o "nuevo"'),
    crear: z.literal(true).optional().describe('Alta; sin él un ETM desconocido es error'),
    nuevo_etm: z.string().optional().describe('Renombra el ETM'),
    descripcion: z.string().optional(),
    descripcion_es: z.string().optional(),
    descripcion_dymmsa: z.string().optional().describe('Curada; texto vacío la borra'),
    codigo_modelo: z.string().optional(),
    marca: z.string().optional().describe('Se guarda en mayúsculas'),
    precio: z.number().min(0).optional(),
    se_vende: z.enum(SOLD_TOKENS).optional(),
  },
  // Absolute values, but `etm: "nuevo"` creates another product each time: not idempotent (Auditoría DYMMSA-WEB §3).
  hints: { destructiveHint: true, idempotentHint: false, openWorldHint: false },
  adminOnly: true,
  confirm: 'two_phase',
  direct: true,
  docs: {
    module: 'Catalogos',
    title: 'Guardar producto ETM',
    example: 'El ETM 1180234 no lo vendemos / Cambia el precio del 1180234 a $245.50.',
    evals: ['El ETM 1180234 no lo vendemos, y en realidad es SURTEK.', 'Da de alta un ETM nuevo para la boquilla de media pulgada, con código interno.'],
    limits: 'Alta y cambios de un producto del catalogo ETM. Cambiar el ETM, el codigo o la marca pide tu confirmacion (mueve el cruce con el catalogo URREA). No borra ni importa archivos.',
  },
  plan: (input, { db }) => planSaveProduct(db, input),
  commit: (_input, { db }, plan) => commitSaveProduct(db, plan),
})
