/** MCP app settings tool (#109): stored rows win, missing rows report the code default. */

import { describe, test, expect } from 'vitest'
import { createMockSupabase } from '../helpers/supabase-mock'
import { type Db } from '@/lib/mcp/shared'
import { getAppSettings } from '@/lib/mcp/tools/settings'

const asDb = (c: ReturnType<typeof createMockSupabase>) => c as unknown as Db

describe('getAppSettings', () => {
  test('mezcla lo guardado con los defaults y dice cuál es cuál', async () => {
    const client = createMockSupabase({
      responses: { app_settings: { data: [{ key: 'purchase_threshold_money', value: 250 }] } },
    })
    const result = await getAppSettings(asDb(client))
    expect(result.planificador_compra).toEqual({ umbral_dinero_parado_mxn: 250, umbral_pct_parado: 0.8 })
    expect(result.corte).toEqual({ margen_por_corte_mm: 20 })
    expect(result.guardadas).toEqual(['purchase_threshold_money'])
    expect(result.por_default).toEqual(['purchase_threshold_pct', 'cut_margin_mm'])
  })

  test('margen 0 guardado es válido (no cae al default)', async () => {
    const client = createMockSupabase({ responses: { app_settings: { data: [{ key: 'cut_margin_mm', value: 0 }] } } })
    expect((await getAppSettings(asDb(client))).corte.margen_por_corte_mm).toBe(0)
  })
})
