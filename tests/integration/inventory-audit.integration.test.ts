/**
 * change_store_stock and the audit trigger of store_inventory against local Supabase (#155 D, decision 7): the
 * compare-and-set of a count, the delta through adjust_inventory, the audit_events row with the actor and the
 * reason, and the privileges. Needs `bunx supabase start` (ADR-021); runs in CI when a PR touches supabase/.
 */
import { describe, test, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@supabase/supabase-js'
import { authedClient, authedClientAs } from './helpers/clients'
import { resetDb, sql, closePool, LOCAL } from './helpers/db'
import { changeStock } from '@/lib/inventory-store'

let admin: SupabaseClient
let member: SupabaseClient

beforeAll(async () => {
  admin = await authedClient()
  member = await authedClientAs(LOCAL.member)
})
beforeEach(async () => {
  await resetDb()
  await sql(`DELETE FROM public.audit_events WHERE entity_type = 'inventory'`)
  await sql(`DELETE FROM public.store_inventory WHERE model_code = 'AUD-1'`)
  await sql(`INSERT INTO public.store_inventory (model_code, quantity, location) VALUES ('AUD-1', 10, 'A1')`)
})
afterAll(async () => { await closePool() })

const events = () =>
  sql<{ action: string; actor_name: string | null; data: Record<string, unknown> }>(
    `SELECT action, actor_name, data FROM public.audit_events WHERE entity_type = 'inventory' ORDER BY created_at, id`,
  )
const quantity = async () => (await sql<{ quantity: number }>(`SELECT quantity FROM public.store_inventory WHERE model_code = 'AUD-1'`))[0].quantity

describe('change_store_stock', () => {
  test('un conteo cambia la cantidad y deja el evento con el actor, antes, después y el motivo', async () => {
    const result = await changeStock(admin, 'AUD-1', { mode: 'count', value: 7, expected: 10 }, 'conteo de prueba')
    expect(result).toMatchObject({ quantity: 7, stale: false })
    expect(await quantity()).toBe(7)
    const rows = await events()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ action: 'quantity_changed', data: { model_code: 'AUD-1', from: 10, to: 7, reason: 'conteo de prueba' } })
    expect(rows[0].actor_name).toBeTruthy()
  })

  test('compare-and-set: si la cantidad ya no es la esperada no escribe y no deja evento', async () => {
    const result = await changeStock(admin, 'AUD-1', { mode: 'count', value: 7, expected: 9 }, 'conteo')
    expect(result).toMatchObject({ quantity: null, stale: true, missing: false })
    expect(await quantity()).toBe(10)
    expect(await events()).toEqual([])
  })

  test('el delta pasa por adjust_inventory: suma, crea la fila de un código nuevo (evento created) y resta con clamp en 0', async () => {
    expect(await changeStock(admin, 'AUD-1', { mode: 'delta', value: 5 }, 'llegaron')).toMatchObject({ quantity: 15 })
    expect(await changeStock(admin, 'AUD-NEW', { mode: 'delta', value: 3 }, 'alta')).toMatchObject({ quantity: 3 })
    expect(await changeStock(admin, 'AUD-1', { mode: 'delta', value: -99 }, 'rotos')).toMatchObject({ quantity: 0, clamped: true })
    expect((await events()).map((e) => e.action)).toEqual(['quantity_changed', 'created', 'quantity_changed'])
    await sql(`DELETE FROM public.store_inventory WHERE model_code = 'AUD-NEW'`)
  })

  test('las reglas: sin motivo, sin código o con un conteo negativo la función rechaza', async () => {
    await expect(changeStock(admin, 'AUD-1', { mode: 'delta', value: 1 }, '  ')).rejects.toMatchObject({ status: 400 })
    await expect(changeStock(admin, ' ', { mode: 'delta', value: 1 }, 'x')).rejects.toMatchObject({ status: 400 })
    await expect(changeStock(admin, 'AUD-1', { mode: 'count', value: -1, expected: 10 }, 'x')).rejects.toMatchObject({ status: 400 })
    expect(await quantity()).toBe(10)
  })

  test('el actor es quien llama: un member que cuenta deja SU nombre', async () => {
    await changeStock(member, 'AUD-1', { mode: 'count', value: 6, expected: 10 }, 'member')
    const [{ display_name }] = await sql<{ display_name: string }>(`SELECT display_name FROM public.profiles WHERE role = 'member'`)
    expect((await events())[0].actor_name).toBe(display_name)
  })
})

describe('el trigger solo audita lo que pasa por la función', () => {
  test('un UPDATE directo (la pantalla) y la recepción de una orden no dejan evento', async () => {
    await sql(`UPDATE public.store_inventory SET quantity = 3 WHERE model_code = 'AUD-1'`)
    await sql(`SELECT public.adjust_inventory('AUD-1', 2)`)
    expect(await quantity()).toBe(5)
    expect(await events()).toEqual([])
  })

  test('la bandera no sobrevive a la llamada: un UPDATE posterior en otra transacción no se audita', async () => {
    await changeStock(admin, 'AUD-1', { mode: 'delta', value: 1 }, 'una vez')
    await sql(`UPDATE public.store_inventory SET quantity = 1 WHERE model_code = 'AUD-1'`)
    expect(await events()).toHaveLength(1)
  })
})

describe('privilegios', () => {
  test('anon no puede ejecutar la función ni leer la bitácora; un member no lee la bitácora', async () => {
    const anon = createClient(LOCAL.url, LOCAL.anon, { auth: { persistSession: false, autoRefreshToken: false } })
    const { error } = await anon.rpc('change_store_stock', { p_model_code: 'AUD-1', p_mode: 'delta', p_value: 1, p_expected: null, p_reason: 'x' })
    expect(error).toBeTruthy()
    expect(await quantity()).toBe(10)
    await changeStock(admin, 'AUD-1', { mode: 'delta', value: 1 }, 'x')
    const { data } = await member.from('audit_events').select('id').eq('entity_type', 'inventory')
    expect(data).toEqual([])
  })
})
