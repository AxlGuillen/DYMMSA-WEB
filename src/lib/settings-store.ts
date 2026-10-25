/** app_settings writes shared by PATCH /api/settings and the MCP's save_app_settings (#155 D): one whitelist, one validator per key. */

import type { SupabaseClient } from '@supabase/supabase-js'
import { DomainError, type DomainErrorKind } from '@/lib/domain-error'
import { DEFAULT_CUT_MARGIN_MM, resolveCutMargin, SETTING_CUT_MARGIN_MM } from '@/lib/cut-plan'
import { DEFAULT_PURCHASE_THRESHOLDS, resolveThresholds, SETTING_THRESHOLD_MONEY, SETTING_THRESHOLD_PCT } from '@/lib/purchase-plan'

export class SettingsError extends DomainError {
  constructor(message: string, kind: DomainErrorKind = 'invalid') {
    super(message, kind)
    this.name = 'SettingsError'
  }
}

const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** app_settings has no seeds (missing row → code default); every new key needs its validator here. */
export const SETTING_VALIDATORS: Record<string, (value: unknown) => boolean> = {
  // Idle money (MXN) — finite number > 0
  [SETTING_THRESHOLD_MONEY]: (v) => isNumber(v) && v > 0,
  // Extra-package fraction — finite number in (0, 1]
  [SETTING_THRESHOLD_PCT]: (v) => isNumber(v) && v > 0 && v <= 1,
  // Cut margin per partition (mm) — 0 is legitimate (#59)
  [SETTING_CUT_MARGIN_MM]: (v) => isNumber(v) && v >= 0,
}

export const SETTING_KEYS = Object.keys(SETTING_VALIDATORS)

/** What each key holds when its row is missing: the code defaults, never a seed. */
export const SETTING_DEFAULTS: Record<string, number> = {
  [SETTING_THRESHOLD_MONEY]: DEFAULT_PURCHASE_THRESHOLDS.money,
  [SETTING_THRESHOLD_PCT]: DEFAULT_PURCHASE_THRESHOLDS.pct,
  [SETTING_CUT_MARGIN_MM]: DEFAULT_CUT_MARGIN_MM,
}

/** The effective value of every key (stored row if valid, else the default), as the planners resolve them. */
export function resolveSettings(stored: Record<string, unknown>): Record<string, number> {
  const thresholds = resolveThresholds(stored)
  return {
    [SETTING_THRESHOLD_MONEY]: thresholds.money,
    [SETTING_THRESHOLD_PCT]: thresholds.pct,
    [SETTING_CUT_MARGIN_MM]: resolveCutMargin(stored),
  }
}

/** All-or-nothing: a patch with an unknown key or an invalid value changes nothing. */
export function validateSettings(settings: unknown): [string, unknown][] {
  const entries = Object.entries((settings ?? {}) as Record<string, unknown>)
  if (entries.length === 0) throw new SettingsError('El body debe incluir "settings" con al menos una key')
  for (const [key, value] of entries) {
    const validate = SETTING_VALIDATORS[key]
    if (!validate) throw new SettingsError(`Configuración desconocida: "${key}"`)
    if (!validate(value)) throw new SettingsError(`Valor inválido para "${key}"`)
  }
  return entries
}

/** The rows that exist, as key → value (a missing key is not here). */
export async function readStoredSettings(db: SupabaseClient, keys: readonly string[] = SETTING_KEYS): Promise<Record<string, unknown>> {
  const { data, error } = await db.from('app_settings').select('key, value').in('key', [...keys])
  if (error) {
    console.error('settings read error:', error)
    throw new SettingsError('Error al cargar la configuración', 'failed')
  }
  return Object.fromEntries(((data ?? []) as { key: string; value: unknown }[]).map((row) => [row.key, row.value]))
}

/** PATCH /api/settings and save_app_settings: one upsert of the whole patch, validated first. */
export async function saveSettings(db: SupabaseClient, settings: unknown): Promise<Record<string, unknown>> {
  const entries = validateSettings(settings)
  const { error } = await db.from('app_settings').upsert(
    entries.map(([key, value]) => ({ key, value })),
    { onConflict: 'key' },
  )
  if (error) {
    console.error('settings write error:', error)
    throw new SettingsError('Error al guardar la configuración', 'failed')
  }
  return Object.fromEntries(entries)
}
