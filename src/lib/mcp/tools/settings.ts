/** App settings (#109 read, #155 D write): the thresholds and margins the planners resolve with defaults. */

import type { WritePlan } from '@/lib/mcp/core/define'
import { diff, writeResult } from '@/lib/mcp/core/envelope'
import { ToolError } from '@/lib/mcp/core/errors'
import type { Db } from '@/lib/mcp/core/db'
import { SETTING_CUT_MARGIN_MM } from '@/lib/cut-plan'
import { SETTING_THRESHOLD_MONEY, SETTING_THRESHOLD_PCT } from '@/lib/purchase-plan'
import { readStoredSettings, resolveSettings, saveSettings, SETTING_DEFAULTS, SETTING_KEYS } from '@/lib/settings-store'

/** The stored rows and the effective values, presented with the names both tools use. */
function present(stored: Record<string, unknown>) {
  const values = resolveSettings(stored)
  return {
    planificador_compra: {
      umbral_dinero_parado_mxn: values[SETTING_THRESHOLD_MONEY],
      umbral_pct_parado: values[SETTING_THRESHOLD_PCT],
    },
    corte: { margen_por_corte_mm: values[SETTING_CUT_MARGIN_MM] },
  }
}

export async function getAppSettings(db: Db) {
  const stored = await readStoredSettings(db)
  return {
    ...present(stored),
    // No seeds: a missing row means the code default is in force — say which is which.
    guardadas: SETTING_KEYS.filter((k) => k in stored),
    por_default: SETTING_KEYS.filter((k) => !(k in stored)),
  }
}

export interface SaveAppSettingsInput {
  umbral_dinero_parado_mxn?: number
  umbral_pct_parado?: number
  margen_por_corte_mm?: number
  restablecer?: true
}

/** Input name → the key the app stores it under. */
const KEY_BY_FIELD = {
  umbral_dinero_parado_mxn: SETTING_THRESHOLD_MONEY,
  umbral_pct_parado: SETTING_THRESHOLD_PCT,
  margen_por_corte_mm: SETTING_CUT_MARGIN_MM,
} as const
const FIELDS = Object.keys(KEY_BY_FIELD) as (keyof typeof KEY_BY_FIELD)[]

const IMPACT =
  'Es global: cambia al vuelo la recomendación de mayoreo/menudeo y el material a pedir en TODAS las órdenes. Las decisiones de compra ya guardadas no cambian.'

interface Carry {
  /** Only the values that really change; keyed by the stored key. */
  patch: Record<string, number>
}

/** Reads the effective values, validates the patch and shows antes → ahora; writes nothing. */
export async function planSaveAppSettings(db: Db, input: SaveAppSettingsInput): Promise<WritePlan<Carry>> {
  const given = FIELDS.filter((f) => input[f] !== undefined)
  if (input.restablecer && given.length > 0) {
    throw new ToolError('Una intención por llamada: `restablecer` y valores sueltos no van juntos. Restablece primero, o manda solo los valores.')
  }
  if (!input.restablecer && given.length === 0) {
    throw new ToolError('Indica al menos un valor (umbral_dinero_parado_mxn, umbral_pct_parado o margen_por_corte_mm) o `restablecer: true`.')
  }

  const stored = await readStoredSettings(db)
  const before = resolveSettings(stored)
  const wanted: Record<string, number> = input.restablecer
    ? { ...SETTING_DEFAULTS }
    : Object.fromEntries(given.map((f) => [KEY_BY_FIELD[f], input[f] as number]))

  const patch = Object.fromEntries(Object.entries(wanted).filter(([key, value]) => before[key] !== value))
  const after = { ...before, ...patch }
  const avisos: string[] = []
  if (Object.keys(patch).length > 0) avisos.push(IMPACT)
  if (SETTING_THRESHOLD_PCT in patch) avisos.push('Subir el % parado puede pasar grupos a «revisar», y «revisar» bloquea guardar el plan hasta decidir.')
  if (input.restablecer) avisos.push('Restablecer escribe los valores de fábrica en las tres llaves; no borra filas.')

  const view = (values: Record<string, number>) => ({
    umbral_dinero_parado_mxn: values[SETTING_THRESHOLD_MONEY],
    umbral_pct_parado: values[SETTING_THRESHOLD_PCT],
    margen_por_corte_mm: values[SETTING_CUT_MARGIN_MM],
  })
  return {
    entity: { key: 'configuracion', value: { ...view(after), de_fabrica: view(SETTING_DEFAULTS) } },
    cambios: diff(view(before), view(after)),
    avisos,
    sinCambios: Object.keys(patch).length === 0,
    // The effective values: after the write they are the new ones, so a repeated key finds another fingerprint.
    fingerprint: before,
    subject: 'La configuración',
    carry: { patch },
  }
}

export async function commitSaveAppSettings(db: Db, plan: WritePlan<Carry>) {
  await saveSettings(db, plan.carry.patch)
  return writeResult('actualizado', plan.entity.key, plan.entity.value, { cambios: plan.cambios, avisos: plan.avisos })
}
