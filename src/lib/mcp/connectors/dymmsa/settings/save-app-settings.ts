import { z } from 'zod'
import { defineTool } from '@/lib/mcp/core/define'
import { commitSaveAppSettings, planSaveAppSettings } from '@/lib/mcp/tools/settings'

export const saveAppSettingsTool = defineTool({
  connector: 'dymmsa',
  name: 'save_app_settings',
  kind: 'write',
  title: 'Guardar configuración',
  description:
    'Cambia los umbrales del planificador de compra (dinero parado en MXN, % parado) y el margen por corte en mm; `restablecer: true` vuelve a los valores de fábrica. Úsala para "sube el umbral a $150" o "corta sin margen". Cambia las recomendaciones de TODAS las órdenes. Dos fases siempre. Nunca acepta otras llaves.',
  input: {
    umbral_dinero_parado_mxn: z.number().positive().optional().describe('MXN, mayor a 0'),
    umbral_pct_parado: z.number().positive().max(1, 'es una fracción (0.8 = 80 %), no un porcentaje como 80').optional().describe('Fracción: 0.8 = 80 %'),
    margen_por_corte_mm: z.number().min(0).optional().describe('mm por corte; 0 vale'),
    restablecer: z.literal(true).optional().describe('Valores de fábrica; no va con valores'),
  },
  // Absolute values on a key unique by name: repeating a call changes nothing more (Auditoría DYMMSA-WEB §3).
  hints: { destructiveHint: true, idempotentHint: true, openWorldHint: false },
  adminOnly: true,
  confirm: 'two_phase',
  docs: {
    module: 'Configuracion',
    title: 'Guardar configuracion',
    example: 'Sube el umbral de dinero parado a $150.',
    evals: ['Sube el umbral de dinero parado a $150.', 'Pon el margen de corte en 3 mm.'],
    limits: 'Solo los umbrales del planificador de compra y el margen de corte; cambia las recomendaciones de todas las ordenes y siempre pide tu confirmacion.',
  },
  plan: (input, { db }) => planSaveAppSettings(db, input),
  commit: (_input, { db }, plan) => commitSaveAppSettings(db, plan),
})
