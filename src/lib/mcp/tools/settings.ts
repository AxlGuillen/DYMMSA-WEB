/** App settings, read-only (#109): the thresholds and margins the planners resolve with defaults. */

import { ToolError, type Db } from '../shared'
import { resolveThresholds, SETTING_THRESHOLD_MONEY, SETTING_THRESHOLD_PCT } from '@/lib/purchase-plan'
import { resolveCutMargin, SETTING_CUT_MARGIN_MM } from '@/lib/cut-plan'

const KEYS = [SETTING_THRESHOLD_MONEY, SETTING_THRESHOLD_PCT, SETTING_CUT_MARGIN_MM]

export async function getAppSettings(db: Db) {
  const { data, error } = await db.from('app_settings').select('key, value').in('key', KEYS)
  if (error) throw new ToolError(`Error al leer la configuración: ${error.message}`)
  const stored = Object.fromEntries(((data ?? []) as { key: string; value: unknown }[]).map((r) => [r.key, r.value]))
  const thresholds = resolveThresholds(stored)
  return {
    planificador_compra: {
      umbral_dinero_parado_mxn: thresholds.money,
      umbral_pct_parado: thresholds.pct,
    },
    corte: { margen_por_corte_mm: resolveCutMargin(stored) },
    // No seeds: a missing row means the code default is in force — say which is which.
    guardadas: KEYS.filter((k) => k in stored),
    por_default: KEYS.filter((k) => !(k in stored)),
  }
}
