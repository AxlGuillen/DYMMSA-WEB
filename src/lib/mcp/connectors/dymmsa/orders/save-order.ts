import { z } from 'zod'
import { defineTool } from '@/lib/mcp/core/define'
import { DELIVERY_TIME_TOKENS } from '@/lib/delivery'
import { ORDER_STATUS_TOKENS } from '@/lib/order-status'
import { commitSaveOrder, planSaveOrder } from '@/lib/mcp/tools/orders-write'

const product = z.strictObject({
  etm: z.string().min(1),
  cantidad: z.number().int().min(1).max(99999),
  precio: z.number().min(0),
  codigo: z.string().optional(),
  marca: z.string().optional(),
  descripcion: z.string().optional(),
})

const change = z.strictObject({
  linea: z.number().int().min(1).max(9999),
  etm: z.string().optional().describe('ETM esperado en esa línea'),
  precio: z.number().min(0).optional(),
  entrega: z.enum(DELIVERY_TIME_TOKENS.tokens).optional(),
  quitar: z.literal(true).optional(),
})

export const saveOrderTool = defineTool({
  connector: 'dymmsa',
  name: 'save_order',
  kind: 'write',
  title: 'Guardar orden',
  description:
    'Crea o edita una orden. Crear: `cotizacion` aprobada (descuenta stock) o `cliente` con `productos` (manual). Editar con `orden`, una intención por llamada: `estado` (cancelar devuelve stock, sin deshacer), `odoo_id` (vacío lo quita) o `cambios` (numeración de get_order) y/o `productos` a agregar. Pide el sí con la clave y muestra el stock que mueve; odoo_id y solo entrega son directos.',
  input: {
    orden: z.string().optional().describe('Nombre, cliente o ref; omitida = crear'),
    cotizacion: z.string().optional(),
    cliente: z.string().optional(),
    productos: z.array(product).min(1).max(200).optional(),
    estado: z.enum(ORDER_STATUS_TOKENS.tokens).optional(),
    odoo_id: z.string().max(80).nullable().optional(),
    cambios: z.array(change).min(1).max(100).optional(),
  },
  // Creating twice is two orders and cancelling is final: not idempotent, destructive (Auditoría DYMMSA-WEB §3: E(1,0)).
  hints: { destructiveHint: true, idempotentHint: false, openWorldHint: false },
  adminOnly: true,
  confirm: 'two_phase',
  direct: true,
  docs: {
    module: 'Ordenes',
    title: 'Guardar orden',
    example: 'Genera la orden de la cotización de Andritz.',
    evals: ['Genera la orden de la cotización de Andritz.', 'Cancela la orden 12.', 'Ponle a la orden 12 el id de Odoo S00045.'],
    limits: 'Crea la orden desde una cotizacion aprobada o manual, cambia su estado, precios, entregas y lineas. Descontar o devolver stock y cancelar piden tu confirmacion. Recibir material es save_order_reception.',
  },
  plan: (input, { db }) => planSaveOrder(db, input),
  commit: (_input, { db, userId }, plan) => commitSaveOrder(db, userId, plan),
})
