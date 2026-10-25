import { z } from 'zod'
import { defineTool } from '@/lib/mcp/core/define'
import { commitSaveUrreaCatalogItem, planSaveUrreaCatalogItem } from '@/lib/mcp/tools/urrea-write'

export const saveUrreaCatalogItemTool = defineTool({
  connector: 'dymmsa',
  name: 'save_urrea_catalog_item',
  kind: 'write',
  title: 'Guardar artículo del catálogo URREA',
  description:
    'Alta o cambio de una fila del catálogo URREA (identidad = código + marca): descripción oficial, std (piezas por paquete) o identidad. Con `crear: true` la da de alta. Úsala para "el 6954 ahora viene en paquete de 12". Solo cambiar la descripción es directo; alta, std o identidad piden el sí con la clave y dicen cuántas decisiones de compra guardadas quedan desactualizadas. No borra ni importa archivos.',
  input: {
    codigo: z.string().describe('Código URREA (se guarda en mayúsculas)'),
    marca: z.string().optional().describe('Default URREA; obligatoria si el código está en varias marcas'),
    crear: z.literal(true).optional().describe('Alta; sin él un código desconocido es error'),
    descripcion: z.string().optional().describe('Oficial; texto vacío la borra'),
    std: z.number().int().min(1).optional().describe('Piezas por paquete'),
    nuevo_codigo: z.string().optional().describe('Cambia el código'),
    nueva_marca: z.string().optional().describe('Cambia la marca'),
  },
  // Absolute values on a row unique by (code, brand): repeating a call changes nothing more.
  hints: { destructiveHint: true, idempotentHint: true, openWorldHint: false },
  adminOnly: true,
  confirm: 'two_phase',
  direct: true,
  docs: {
    module: 'Catalogos',
    title: 'Guardar articulo del catalogo URREA',
    example: 'El 6954 ahora viene en paquete de 12, no de 10.',
    evals: ['El 6954 ahora viene en paquete de 12, no de 10.', 'Agrega al catálogo el SK-120 de SURTEK, paquete de 6.'],
    limits: 'Alta y cambios de una fila del catalogo. Cambiar std, codigo, marca o dar de alta pide tu confirmacion y dice cuantas decisiones de compra quedan desactualizadas. No borra ni importa archivos.',
  },
  plan: (input, { db }) => planSaveUrreaCatalogItem(db, input),
  commit: (_input, { db }, plan) => commitSaveUrreaCatalogItem(db, plan),
})
