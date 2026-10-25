/** settings-store (#155 D): one whitelist shared by PATCH /api/settings and save_app_settings. */

import { describe, test, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createMockSupabase } from '../helpers/supabase-mock'
import { readStoredSettings, resolveSettings, saveSettings, SETTING_DEFAULTS, SETTING_KEYS, SettingsError, validateSettings } from '@/lib/settings-store'

const asDb = (c: ReturnType<typeof createMockSupabase>) => c as unknown as SupabaseClient

describe('validateSettings', () => {
  test('la whitelist son exactamente las tres llaves de la app', () => {
    expect(SETTING_KEYS).toEqual(['purchase_threshold_money', 'purchase_threshold_pct', 'cut_margin_mm'])
    expect(SETTING_DEFAULTS).toEqual({ purchase_threshold_money: 100, purchase_threshold_pct: 0.8, cut_margin_mm: 20 })
  })

  test('vacío, llave desconocida y valor inválido son errores de regla (400)', () => {
    for (const bad of [undefined, {}, { random_key: 1 }, { purchase_threshold_money: -5 }, { purchase_threshold_pct: 80 }, { cut_margin_mm: '3' }]) {
      const error = (() => {
        try {
          validateSettings(bad)
        } catch (e) {
          return e as SettingsError
        }
      })()
      expect(error, JSON.stringify(bad)).toBeInstanceOf(SettingsError)
      expect(error?.status).toBe(400)
    }
  })

  test('cut_margin_mm: 0 es legítimo; el % acepta hasta 1 inclusive', () => {
    expect(validateSettings({ cut_margin_mm: 0, purchase_threshold_pct: 1 })).toEqual([['cut_margin_mm', 0], ['purchase_threshold_pct', 1]])
  })

  test('todo o nada: una llave mala invalida el parche completo', () => {
    expect(() => validateSettings({ purchase_threshold_money: 150, cut_margin_mm: -1 })).toThrow('Valor inválido para "cut_margin_mm"')
  })
})

describe('resolveSettings', () => {
  test('lo guardado válido gana; lo inválido o ausente cae al default', () => {
    expect(resolveSettings({ purchase_threshold_money: 250, purchase_threshold_pct: 5 })).toEqual({
      purchase_threshold_money: 250,
      purchase_threshold_pct: 0.8,
      cut_margin_mm: 20,
    })
  })
})

describe('readStoredSettings / saveSettings', () => {
  test('lee solo las llaves de la whitelist', async () => {
    const db = createMockSupabase({ responses: { 'app_settings.select': { data: [{ key: 'cut_margin_mm', value: 0 }] } } })
    expect(await readStoredSettings(asDb(db))).toEqual({ cut_margin_mm: 0 })
    expect(db.callsTo('app_settings', 'select')[0].filters).toEqual([{ method: 'in', args: ['key', SETTING_KEYS] }])
  })

  test('un solo upsert por llave con onConflict', async () => {
    const db = createMockSupabase({ responses: { 'app_settings.upsert': { data: null, error: null } } })
    expect(await saveSettings(asDb(db), { purchase_threshold_money: 150 })).toEqual({ purchase_threshold_money: 150 })
    expect(db.upsertPayload('app_settings')).toEqual([{ key: 'purchase_threshold_money', value: 150 }])
    expect(db.callsTo('app_settings', 'upsert')[0].options).toEqual({ onConflict: 'key' })
  })

  test('una llave mala no llega a la BD', async () => {
    const db = createMockSupabase()
    await expect(saveSettings(asDb(db), { nope: 1 })).rejects.toThrow('Configuración desconocida')
    expect(db.callsTo('app_settings')).toEqual([])
  })

  test('un fallo de la BD es 500 con mensaje en español', async () => {
    const db = createMockSupabase({ responses: { 'app_settings.upsert': { data: null, error: { message: 'boom' } } } })
    await expect(saveSettings(asDb(db), { cut_margin_mm: 3 })).rejects.toMatchObject({ status: 500, message: 'Error al guardar la configuración' })
  })
})
