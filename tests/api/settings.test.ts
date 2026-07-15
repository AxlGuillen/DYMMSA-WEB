/**
 * /api/settings — configuración key-value (app_settings).
 *
 * La whitelist de PATCH es la regla crítica: cada key se valida con su
 * validador registrado; keys desconocidas se rechazan (app_settings no es
 * un dumping ground sin validar).
 */

import { describe, test, expect, vi } from 'vitest'
import {
  createMockSupabase,
  MockSupabaseClient,
  filterValue,
} from '../helpers/supabase-mock'
import { injectSupabaseServer } from '../helpers/setup'
import { AUTH } from '../helpers/factories'
import { makeRequest, readJson } from '../helpers/request'
import * as settingsRoute from '@/app/api/settings/route'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

let activeClient: MockSupabaseClient
injectSupabaseServer(() => activeClient)

const get = (url?: string) => settingsRoute.GET(makeRequest(undefined, { url }))
const patch = (body: unknown) => settingsRoute.PATCH(makeRequest(body, { method: 'PATCH' }))

describe('GET /settings', () => {
  test('devuelve las filas como Record key→value', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'app_settings.select': {
          data: [
            { key: 'purchase_threshold_money', value: 150 },
            { key: 'purchase_threshold_pct', value: 0.7 },
          ],
          error: null,
        },
      },
    })
    const res = await get()
    expect(res.status).toBe(200)
    const { settings } = await readJson<{ settings: Record<string, unknown> }>(res)
    expect(settings).toEqual({ purchase_threshold_money: 150, purchase_threshold_pct: 0.7 })
  })

  test('?keys= filtra con .in()', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'app_settings.select': { data: [], error: null } },
    })
    await get('http://localhost/api/settings?keys=purchase_threshold_money, purchase_threshold_pct')
    const call = activeClient.callsTo('app_settings', 'select')[0]
    expect(filterValue(call, 'key', 'in')).toEqual([
      'purchase_threshold_money',
      'purchase_threshold_pct',
    ])
  })
})

describe('PATCH /settings', () => {
  const withAuth = () => createMockSupabase({ user: AUTH })

  test('400 sin settings o vacío', async () => {
    activeClient = withAuth()
    expect((await patch({})).status).toBe(400)
    activeClient = withAuth()
    expect((await patch({ settings: {} })).status).toBe(400)
  })

  test('REGLA: key desconocida → 400 (whitelist estricta)', async () => {
    activeClient = withAuth()
    const res = await patch({ settings: { random_key: 1 } })
    expect(res.status).toBe(400)
    expect((await readJson<{ message: string }>(res)).message).toContain('random_key')
  })

  test('valores fuera de rango → 400', async () => {
    activeClient = withAuth()
    expect((await patch({ settings: { purchase_threshold_money: -5 } })).status).toBe(400)
    activeClient = withAuth()
    expect((await patch({ settings: { purchase_threshold_money: '100' } })).status).toBe(400)
    activeClient = withAuth()
    expect((await patch({ settings: { purchase_threshold_pct: 1.5 } })).status).toBe(400)
    activeClient = withAuth()
    expect((await patch({ settings: { purchase_threshold_pct: 0 } })).status).toBe(400)
  })

  test('happy path: upsert por key y eco del body', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'app_settings.upsert': { data: null, error: null } },
    })
    const res = await patch({
      settings: { purchase_threshold_money: 200, purchase_threshold_pct: 0.9 },
    })
    expect(res.status).toBe(200)

    const rows = activeClient.upsertPayload('app_settings')
    expect(rows).toEqual([
      { key: 'purchase_threshold_money', value: 200 },
      { key: 'purchase_threshold_pct', value: 0.9 },
    ])
    const call = activeClient.callsTo('app_settings', 'upsert')[0]
    expect(call.options).toEqual({ onConflict: 'key' })

    const { settings } = await readJson<{ settings: Record<string, unknown> }>(res)
    expect(settings.purchase_threshold_money).toBe(200)
  })

  test('error de BD → 500', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'app_settings.upsert': { data: null, error: { message: 'boom' } } },
    })
    expect((await patch({ settings: { purchase_threshold_money: 200 } })).status).toBe(500)
  })
})
