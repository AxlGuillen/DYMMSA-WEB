/**
 * Audit trail of payables against local Supabase (ADR-021/ADR-028): the trigger writes as
 * DEFINER with the caller's identity, and only an admin can read the table. The mock cannot
 * fake either — this is the only real proof of the RLS and of the trigger.
 */
import { describe, test, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { injectSupabaseServer } from '../helpers/setup'
import { makeRequest, makeParams, readJson } from '../helpers/request'
import { authedClient, authedClientAs } from './helpers/clients'
import { resetDb, sql, closePool, LOCAL } from './helpers/db'
import * as payablesRoute from '@/app/api/payables/route'
import * as payableById from '@/app/api/payables/[id]/route'
import * as payableEvents from '@/app/api/payables/[id]/events/route'
import type { AuditEvent, PayableWithSupplier } from '@/types/database'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

let admin: SupabaseClient
let member: SupabaseClient
let activeClient: SupabaseClient
injectSupabaseServer(() => activeClient as never)

beforeAll(async () => {
  admin = await authedClient()
  member = await authedClientAs(LOCAL.member)
})
beforeEach(async () => { await resetDb(); activeClient = admin })
afterAll(async () => { await closePool() })

/** One pending payable written with the service role; returns its id. */
async function seedPayable(): Promise<string> {
  const [{ id: supplierId }] = await sql<{ id: string }>(
    `INSERT INTO public.suppliers (name) VALUES ('Proveedor Audit') RETURNING id`,
  )
  const [{ id }] = await sql<{ id: string }>(
    `INSERT INTO public.payables (supplier_id, concept, amount, invoice_date, due_date)
     VALUES ($1, 'Factura auditada', 1500, '2026-09-01', '2026-10-01') RETURNING id`,
    [supplierId],
  )
  return id
}

const events = (id: string) =>
  sql<{ action: string; actor_name: string | null; data: Record<string, unknown> }>(
    `SELECT action, actor_name, data FROM public.audit_events
      WHERE entity_type = 'payable' AND entity_id = $1 ORDER BY created_at`,
    [id],
  )

describe('trigger payables_audit', () => {
  test('un member que marca pagada deja el evento con SU nombre; el service role deja actor null', async () => {
    const id = await seedPayable()
    // The seed insert ran as service role: created with no actor.
    expect(await events(id)).toMatchObject([{ action: 'created', actor_name: null }])

    activeClient = member
    const res = await payableById.PATCH(
      makeRequest({ status: 'paid', paid_at: '2026-09-10' }, { method: 'PATCH' }),
      makeParams({ id }),
    )
    expect(res.status).toBe(200)

    const rows = await events(id)
    expect(rows).toHaveLength(2)
    expect(rows[1]).toMatchObject({
      action: 'status_changed',
      data: { from: { status: 'pending', paid_at: null }, to: { status: 'paid', paid_at: '2026-09-10' } },
    })
    expect(rows[1].actor_name).toBeTruthy()
    const [{ display_name }] = await sql<{ display_name: string }>(
      `SELECT display_name FROM public.profiles WHERE role = 'member'`,
    )
    expect(rows[1].actor_name).toBe(display_name)
  })

  test('corregir solo la fecha registra paid_at_changed; editar el concepto no registra nada', async () => {
    const id = await seedPayable()
    await sql(`UPDATE public.payables SET status = 'paid', paid_at = '2026-09-10' WHERE id = $1`, [id])
    await sql(`UPDATE public.payables SET paid_at = '2026-09-12' WHERE id = $1`, [id])
    await sql(`UPDATE public.payables SET concept = 'Otro concepto' WHERE id = $1`, [id])
    expect((await events(id)).map((e) => e.action)).toEqual(['created', 'status_changed', 'paid_at_changed'])
  })

  test('borrar la factura deja el evento deleted con su snapshot', async () => {
    const id = await seedPayable()
    activeClient = admin
    expect((await payableById.DELETE(makeRequest(undefined, { method: 'DELETE' }), makeParams({ id }))).status).toBe(200)
    const rows = await events(id)
    expect(rows.at(-1)).toMatchObject({ action: 'deleted', data: { concept: 'Factura auditada', currency: 'MXN' } })
    expect(rows.at(-1)!.actor_name).toBeTruthy()

    // #157: deleting it again is a 404, not an ok, and leaves no second event.
    expect((await payableById.DELETE(makeRequest(undefined, { method: 'DELETE' }), makeParams({ id }))).status).toBe(404)
    expect((await events(id)).filter((e) => e.action === 'deleted')).toHaveLength(1)
  })

  test('#157: el alta guarda la moneda en su snapshot', async () => {
    const id = await seedPayable()
    expect((await events(id))[0]).toMatchObject({ action: 'created', data: { concept: 'Factura auditada', amount: 1500, currency: 'MXN' } })
  })

  test('#157: corregir monto o moneda deja amount_changed con antes/después, con el actor de la sesión', async () => {
    const id = await seedPayable()
    activeClient = member
    const res = await payableById.PATCH(makeRequest({ amount: 1800 }, { method: 'PATCH' }), makeParams({ id }))
    expect(res.status).toBe(200)
    await payableById.PATCH(makeRequest({ currency: 'USD', amount: 90 }, { method: 'PATCH' }), makeParams({ id }))

    const rows = (await events(id)).filter((e) => e.action === 'amount_changed')
    expect(rows.map((e) => e.data)).toEqual([
      { from: { amount: 1500, currency: 'MXN' }, to: { amount: 1800, currency: 'MXN' } },
      { from: { amount: 1800, currency: 'MXN' }, to: { amount: 90, currency: 'USD' } },
    ])
    const [{ display_name }] = await sql<{ display_name: string }>(`SELECT display_name FROM public.profiles WHERE role = 'member'`)
    expect(rows.every((e) => e.actor_name === display_name)).toBe(true)
  })

  test('#157: un solo UPDATE de estado y monto deja dos eventos; el concepto sigue sin auditarse', async () => {
    const id = await seedPayable()
    await sql(`UPDATE public.payables SET status = 'paid', paid_at = '2026-09-10', amount = 1600 WHERE id = $1`, [id])
    await sql(`UPDATE public.payables SET concept = 'Otro', notes = 'nota', due_date = '2026-11-01' WHERE id = $1`, [id])
    expect((await events(id)).map((e) => e.action).sort()).toEqual(['amount_changed', 'created', 'status_changed'])
  })

  test('#157: la ruta rechaza paid_at sin status en una pendiente o cancelada, y no escribe nada', async () => {
    const id = await seedPayable()
    activeClient = admin
    const pending = await payableById.PATCH(makeRequest({ paid_at: '2026-09-10' }, { method: 'PATCH' }), makeParams({ id }))
    expect(pending.status).toBe(400)

    await sql(`UPDATE public.payables SET status = 'cancelled' WHERE id = $1`, [id])
    const cancelled = await payableById.PATCH(makeRequest({ paid_at: '2026-09-10' }, { method: 'PATCH' }), makeParams({ id }))
    expect(cancelled.status).toBe(400)
    const [row] = await sql<{ status: string; paid_at: string | null }>(`SELECT status, paid_at::text FROM public.payables WHERE id = $1`, [id])
    expect(row).toEqual({ status: 'cancelled', paid_at: null })

    // A paid one still takes a date fix.
    await sql(`UPDATE public.payables SET status = 'paid', paid_at = '2026-09-10' WHERE id = $1`, [id])
    const fixed = await payableById.PATCH(makeRequest({ paid_at: '2026-09-12' }, { method: 'PATCH' }), makeParams({ id }))
    expect(fixed.status).toBe(200)
    expect((await events(id)).at(-1)).toMatchObject({ action: 'paid_at_changed', data: { to: { paid_at: '2026-09-12' } } })
  })
})

describe('RLS de audit_events (directo al cliente)', () => {
  test('member: 0 filas y sin permiso de INSERT; admin: lee todo', async () => {
    const id = await seedPayable()
    await sql(`UPDATE public.payables SET status = 'paid', paid_at = '2026-09-10' WHERE id = $1`, [id])

    const mine = await member.from('audit_events').select('id')
    expect(mine.error).toBeNull()
    expect(mine.data).toHaveLength(0)

    const insert = await member.from('audit_events').insert({ entity_type: 'x', entity_id: id, action: 'y' })
    expect(insert.error).not.toBeNull()

    const all = await admin.from('audit_events').select('action').eq('entity_id', id)
    expect(all.data?.map((r) => r.action).sort()).toEqual(['created', 'status_changed'])
  })
})

describe('rutas con auth real', () => {
  test('GET /api/payables: el admin recibe paid_by; el member no recibe la llave', async () => {
    const id = await seedPayable()
    activeClient = member
    await payableById.PATCH(makeRequest({ status: 'paid' }, { method: 'PATCH' }), makeParams({ id }))

    activeClient = admin
    const asAdmin = await readJson<{ data: PayableWithSupplier[] }>(
      await payablesRoute.GET(makeRequest(undefined, { url: 'http://x/api/payables' })),
    )
    expect(asAdmin.data[0].paid_by).toMatchObject({ name: expect.any(String) })

    activeClient = member
    const asMember = await readJson<{ data: Record<string, unknown>[] }>(
      await payablesRoute.GET(makeRequest(undefined, { url: 'http://x/api/payables' })),
    )
    expect('paid_by' in asMember.data[0]).toBe(false)
  })

  test('GET /api/payables/[id]/events: 200 admin, 403 member', async () => {
    const id = await seedPayable()
    activeClient = admin
    const ok = await payableEvents.GET(makeRequest(undefined), makeParams({ id }))
    expect(ok.status).toBe(200)
    expect((await readJson<AuditEvent[]>(ok)).map((e) => e.action)).toEqual(['created'])

    activeClient = member
    expect((await payableEvents.GET(makeRequest(undefined), makeParams({ id }))).status).toBe(403)
  })
})
