import { z } from 'zod'
import { defineTool } from '@/lib/mcp/core/define'
import { DELIVERY_TIME_TOKENS } from '@/lib/delivery'
import { MANUAL_QUOTATION_STATUSES, QUOTATION_STATUS_TOKENS } from '@/lib/quotation-status'
import { APPROVAL_TOKENS, SOLD_TOKENS } from '@/lib/tokens'
import { commitSaveQuotation, planSaveQuotation } from '@/lib/mcp/tools/quotations-write'

const line = z.strictObject({
  etm: z.string().optional().describe('ETM, o "nuevo" para un código interno'),
  seccion: z.string().optional().describe('Título de sección, en vez de producto'),
  cantidad: z.number().int().min(1).optional(),
  precio: z.number().min(0).optional().describe('Omitido = el del catálogo'),
  entrega: z.enum(DELIVERY_TIME_TOKENS.tokens).optional(),
  codigo: z.string().optional().describe('Solo si el ETM no está en el catálogo'),
  marca: z.string().optional(),
  descripcion: z.string().optional(),
  despues_de: z.number().int().min(0).optional().describe('Al agregar: tras la línea N (0 = inicio; omitido = final)'),
})

const change = z.strictObject({
  linea: z.union([z.number().int().min(1), z.array(z.number().int().min(1)).min(1), z.literal('todas')]).optional().describe('N, [N, M] o "todas" (numeración de get_quotation)'),
  etm: z.string().optional().describe('Guarda: el ETM que crees que tiene esa línea'),
  precio: z.number().min(0).optional(),
  cantidad: z.number().int().min(1).optional(),
  entrega: z.enum(DELIVERY_TIME_TOKENS.tokens).optional(),
  se_vende: z.enum(SOLD_TOKENS).optional(),
  aprobacion: z.enum(APPROVAL_TOKENS).optional().describe('Lo que dijo el cliente; no en revisión'),
  descripcion_dymmsa: z.string().optional(),
  quitar: z.literal(true).optional(),
  despues_de: z.number().int().min(0).optional().describe('Mueve la línea tras la N (0 = inicio)'),
})

const STATES = MANUAL_QUOTATION_STATUSES.map((status) => QUOTATION_STATUS_TOKENS.toToken(status)) as [string, ...string[]]

export const saveQuotationTool = defineTool({
  connector: 'dymmsa',
  name: 'save_quotation',
  kind: 'write',
  title: 'Guardar cotización',
  description:
    'Crea, edita o cambia de estado una cotización de la app (la de Odoo es odoo_save_quotation). Una intención por llamada. Crear: nombre, cliente y `lineas` (se prellenan del catálogo ETM). Editar: `cambios` por línea (numeración de get_quotation), `lineas` para agregar y/o nombre y cliente. Estado: borrador, en_revision, aprobada o rechazada; cambiarlo regenera el link de aprobación. Úsala para "ponle entrega 1 semana a todo" o "mándala a aprobación". Crear, editar y casi todo cambio de estado piden el sí con la clave; borrador → en_revision es directo. No borra ni genera la orden.',
  input: {
    cotizacion: z.string().optional().describe('Nombre, cliente o ref; omitida = crear'),
    nombre: z.string().optional(),
    cliente: z.string().optional(),
    lineas: z.array(line).min(1).max(200).optional().describe('Crear: todas, en orden. Editar: las que se agregan'),
    cambios: z.array(change).min(1).max(100).optional(),
    estado: z.enum(STATES).optional(),
    version: z.string().optional().describe('De get_quotation; si cambió, no escribe'),
  },
  // Edits with absolute values, but a repeated create is a second quotation: not idempotent (Auditoría DYMMSA-WEB §3: E(1,0)).
  hints: { destructiveHint: true, idempotentHint: false, openWorldHint: false },
  adminOnly: true,
  confirm: 'two_phase',
  direct: true,
  docs: {
    module: 'Cotizaciones',
    title: 'Guardar cotizacion',
    example: 'Ponle entrega 1 semana a toda la cotizacion de Andritz y cambia el precio de la linea 4 a 385.',
    evals: [
      'A la cotización de Andritz cámbiale el precio de la línea 4 a 385 y ponle entrega 1 semana a todo.',
      'Hazme una cotización para GE Power con estos 6 productos.',
      'El cliente aprueba todo menos la línea 5 de la cotización de Truper; regístralo.',
    ],
    limits: 'Crea, edita por linea y cambia el estado de una cotizacion de la app (no la de Odoo). Casi todo pide tu confirmacion; mandarla a revision desde borrador es directo. No la borra ni genera la orden.',
  },
  plan: (input, { db }) => planSaveQuotation(db, input),
  commit: (_input, { db, userId }, plan) => commitSaveQuotation(db, userId, plan),
})
