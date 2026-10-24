import { z } from 'zod'
import { defineTool } from '@/lib/mcp/core/define'
import { isoDate } from '@/lib/mcp/core/schema'
import { commitDeleteRecord, planDeleteRecord, RECORD_TYPES } from '@/lib/mcp/tools/records'

export const deleteRecordTool = defineTool({
  connector: 'dymmsa',
  name: 'delete_record',
  kind: 'write',
  title: 'Borrar un registro',
  description:
    'El único borrado: `tipo` = proveedor, marca, medida (de material), factura (pendiente o cancelada), checada o dia_justificado. Dos fases siempre: la primera dice qué se pierde (una checada importada vuelve con el re-import) o qué lo bloquea (un proveedor con facturas, una marca en uso, una factura pagada). Úsala para "borra la factura que registré dos veces". Nunca borra cotizaciones, órdenes, productos, inventario ni catálogo.',
  input: {
    tipo: z.enum(RECORD_TYPES),
    referencia: z.string().optional().describe('Proveedor, marca o factura: nombre o ref'),
    persona: z.string().optional().describe('Checada: la persona (default tú). Día justificado: omitida = todo el equipo'),
    fecha: isoDate.optional().describe('Checada o día justificado'),
    entrada: z.string().optional().describe('Checada: su entrada actual, HH:MM'),
    material: z.enum(['tubo', 'placa']).optional().describe('Medida'),
    diametro_mm: z.number().positive().optional().describe('Medida de tubo'),
    espesor_mm: z.number().positive().optional().describe('Medida de placa'),
    ancho_mm: z.number().positive().optional().describe('Medida de placa'),
    largo_mm: z.number().positive().optional().describe('Medida: largo comercial'),
  },
  // The one delete (ADR-041 §4): it destroys, and repeating it only finds nothing left (Auditoría DYMMSA-WEB §4.8).
  hints: { destructiveHint: true, idempotentHint: true, openWorldHint: false },
  // Deleting is an administrator's call: the member's list does not carry it (#133), the RLS still backs it.
  adminOnly: true,
  confirm: 'two_phase',
  docs: {
    module: 'Borrados',
    title: 'Borrar un registro',
    example: 'Borra la factura de Tornillos que registre dos veces.',
    limits: 'Proveedores, marcas, medidas de material, facturas por pagar (no pagadas), checadas y dias justificados, siempre con tu confirmacion. Nunca cotizaciones, ordenes, productos, inventario ni catalogo.',
  },
  plan: (input, { db, userId }) => planDeleteRecord(db, userId, input),
  commit: (_input, { db }, plan) => commitDeleteRecord(db, plan),
})
