import { z } from 'zod'
import { defineTool } from '@/lib/mcp/core/define'
import { saveMaterialPresentation } from '@/lib/mcp/tools/cutting'

export const saveMaterialPresentationTool = defineTool({
  connector: 'dymmsa',
  name: 'save_material_presentation',
  kind: 'write',
  title: 'Registrar medida de material',
  description:
    'Registra una presentación del proveedor para el corte: barra de tubo (diámetro y largo) u hoja de placa (espesor, ancho y largo), SIEMPRE en mm — convierte pulgadas (×25.4) y metros y confirma la conversión con el usuario antes de guardar. Si ya existía, la marca como la más reciente. ESCRIBE. No borra medidas.',
  input: {
    tipo: z.enum(['tubo', 'placa']),
    diametro_mm: z.number().positive().optional().describe('Tubo'),
    espesor_mm: z.number().positive().optional().describe('Placa'),
    ancho_mm: z.number().positive().optional().describe('Placa'),
    largo_mm: z.number().positive().describe('Largo comercial de la barra u hoja'),
  },
  // Scoped write (#134, ADR-037): a catalog that already builds itself from captures.
  // An upsert by its measure: it only adds or refreshes, so a repeat is a no-op (#155 C2).
  hints: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
  docs: {
    module: 'Ordenes',
    title: 'Registrar medida de material',
    example: 'Agrega barra de tubo de 1 pulgada de 6 metros.',
    evals: ['Agrega una barra de tubo de 1 pulgada de 6 metros.', 'El proveedor vende hojas de placa de 3 mm de 1220 por 2440.'],
    limits: 'Solo registra barras de tubo u hojas de placa, en mm. No borra medidas ni toca la lista de corte.',
  },
  handler: (input, { db }) => saveMaterialPresentation(db, input),
})
