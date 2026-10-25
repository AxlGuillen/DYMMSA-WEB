/** MCP app settings tools (#109 read, #155 D write): stored rows win, missing rows report the code default. */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import type { MockSupabaseClient } from '../helpers/supabase-mock'

const state = vi.hoisted(() => ({ db: null as unknown as MockSupabaseClient }))

vi.mock('@/lib/mcp/core/auth/supabase', () => ({ clientForToken: vi.fn(() => state.db), verifierClient: vi.fn() }))

import { createMockSupabase } from '../helpers/supabase-mock'
import { connectMcp, textOf } from './harness'
import { TEST_PREVIEW_SECRET } from '../helpers/preview-secret'
import type { Db } from '@/lib/mcp/core/db'
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

/** save_app_settings through the real SDK: always two phases, absolute values, never a generic key. */
describe('save_app_settings', () => {
  beforeEach(() => {
    vi.stubEnv('MCP_PREVIEW_SECRET', TEST_PREVIEW_SECRET)
  })
  afterEach(() => vi.unstubAllEnvs())

  const parse = (text: string) => JSON.parse(text) as Record<string, unknown>

  /** A table that remembers the upserts, so a second read sees the new values. */
  function table(initial: { key: string; value: unknown }[] = []) {
    const rows = [...initial]
    return createMockSupabase({
      responses: {
        'app_settings.select': () => ({ data: rows, error: null }),
        'app_settings.upsert': (rec) => {
          for (const row of rec.payload as { key: string; value: unknown }[]) {
            const i = rows.findIndex((r) => r.key === row.key)
            if (i >= 0) rows[i] = row
            else rows.push(row)
          }
          return { data: null, error: null }
        },
      },
    })
  }

  async function both(args: Record<string, unknown>) {
    const mcp = await connectMcp('admin')
    try {
      const first = await mcp.call('save_app_settings', args)
      const key = first.isError ? null : parse(textOf(first)).clave
      const second = key ? await mcp.call('save_app_settings', { ...args, clave: key }) : null
      return { first, second }
    } finally {
      await mcp.close()
    }
  }

  const writes = (db: MockSupabaseClient) => db.callsTo('app_settings', 'upsert')

  test('la fase 1 muestra antes → ahora y avisa del impacto global, sin escribir; con la clave guarda solo lo que cambia', async () => {
    state.db = table([{ key: 'purchase_threshold_money', value: 100 }])
    const { first, second } = await both({ umbral_dinero_parado_mxn: 150, margen_por_corte_mm: 20 })
    const one = parse(textOf(first))
    expect(one).toMatchObject({ accion: 'simulado', escrito: false, cambios: { umbral_dinero_parado_mxn: { antes: 100, ahora: 150 } } })
    // The margin already was 20 (the default): it is not part of the write.
    expect(Object.keys(one.cambios as object)).toEqual(['umbral_dinero_parado_mxn'])
    expect(one.avisos).toEqual([expect.stringMatching(/TODAS las órdenes/)])
    expect(second?.isError, textOf(second!)).toBeFalsy()
    expect(parse(textOf(second!))).toMatchObject({ accion: 'actualizado', escrito: true, configuracion: { umbral_dinero_parado_mxn: 150, margen_por_corte_mm: 20 } })
    expect(writes(state.db)).toHaveLength(1)
    expect(state.db.upsertPayload('app_settings')).toEqual([{ key: 'purchase_threshold_money', value: 150 }])
  })

  test('la fase 1 sola nunca escribe', async () => {
    state.db = table()
    const mcp = await connectMcp('admin')
    try {
      await mcp.call('save_app_settings', { umbral_dinero_parado_mxn: 150 })
      await mcp.call('save_app_settings', { umbral_dinero_parado_mxn: 150 })
    } finally {
      await mcp.close()
    }
    expect(writes(state.db)).toEqual([])
  })

  test('REGLA: repetir la misma clave después de escribir no escribe otra vez (la huella cambió con la escritura)', async () => {
    state.db = table()
    const mcp = await connectMcp('admin')
    try {
      const first = parse(textOf(await mcp.call('save_app_settings', { margen_por_corte_mm: 0 })))
      await mcp.call('save_app_settings', { margen_por_corte_mm: 0, clave: first.clave })
      const again = await mcp.call('save_app_settings', { margen_por_corte_mm: 0, clave: first.clave })
      expect(parse(textOf(again))).toMatchObject({ accion: 'sin_cambios', escrito: false })
    } finally {
      await mcp.close()
    }
    expect(writes(state.db)).toHaveLength(1)
    expect(state.db.upsertPayload('app_settings')).toEqual([{ key: 'cut_margin_mm', value: 0 }])
  })

  test('el margen 0 es válido y el % exige fracción (80 se rechaza explicando 0.8)', async () => {
    state.db = table()
    const { first } = await both({ margen_por_corte_mm: 0 })
    expect(parse(textOf(first)).cambios).toEqual({ margen_por_corte_mm: { antes: 20, ahora: 0 } })

    const bad = await both({ umbral_pct_parado: 80 })
    expect(bad.first.isError).toBe(true)
    expect(textOf(bad.first)).toMatch(/fracción \(0\.8 = 80 %\)/)
  })

  test('restablecer escribe los valores de fábrica de las llaves que difieren, sin borrar filas', async () => {
    state.db = table([
      { key: 'purchase_threshold_money', value: 250 },
      { key: 'purchase_threshold_pct', value: 0.5 },
      { key: 'cut_margin_mm', value: 20 },
    ])
    const { first, second } = await both({ restablecer: true })
    expect(parse(textOf(first)).cambios).toEqual({
      umbral_dinero_parado_mxn: { antes: 250, ahora: 100 },
      umbral_pct_parado: { antes: 0.5, ahora: 0.8 },
    })
    expect(second?.isError).toBeFalsy()
    expect(state.db.upsertPayload('app_settings')).toEqual([
      { key: 'purchase_threshold_money', value: 100 },
      { key: 'purchase_threshold_pct', value: 0.8 },
    ])
    expect(state.db.callsTo('app_settings', 'delete')).toEqual([])
  })

  test('sin cambios reales responde sin_cambios y no emite clave', async () => {
    state.db = table()
    const { first } = await both({ umbral_dinero_parado_mxn: 100 })
    expect(parse(textOf(first))).toMatchObject({ accion: 'sin_cambios', escrito: false })
    expect(parse(textOf(first))).not.toHaveProperty('clave')
  })

  test('una intención por llamada, al menos un valor y campos desconocidos son errores que no escriben', async () => {
    state.db = table()
    for (const args of [{ restablecer: true, margen_por_corte_mm: 3 }, {}, { clave_cualquiera: 'x' }, { llave: 'cut_margin_mm', valor: 3 }]) {
      const { first } = await both(args)
      expect(first.isError, JSON.stringify(args)).toBe(true)
    }
    expect(writes(state.db)).toEqual([])
  })

  test('la huella: si otro cambió el umbral entre el resumen y el sí, no escribe', async () => {
    state.db = table()
    const mcp = await connectMcp('admin')
    let after: MockSupabaseClient
    try {
      const first = parse(textOf(await mcp.call('save_app_settings', { umbral_dinero_parado_mxn: 150 })))
      after = state.db = table([{ key: 'purchase_threshold_money', value: 300 }])
      const second = await mcp.call('save_app_settings', { umbral_dinero_parado_mxn: 150, clave: first.clave })
      expect(second.isError).toBe(true)
      expect(textOf(second)).toBe('La configuración cambió desde el resumen: vuelve a pedirlo. No escribí nada.')
    } finally {
      await mcp.close()
    }
    expect(writes(after)).toEqual([])
  })

  test('sin MCP_PREVIEW_SECRET no escribe ni da resumen; un member ni la recibe', async () => {
    state.db = table()
    vi.stubEnv('MCP_PREVIEW_SECRET', '')
    const { first } = await both({ margen_por_corte_mm: 3 })
    expect(first.isError).toBe(true)
    expect(textOf(first)).toMatch(/todavía no está activada/)
    const member = await connectMcp('member')
    try {
      expect((await member.tools()).map((t) => t.name)).not.toContain('save_app_settings')
    } finally {
      await member.close()
    }
    expect(writes(state.db)).toEqual([])
  })
})
