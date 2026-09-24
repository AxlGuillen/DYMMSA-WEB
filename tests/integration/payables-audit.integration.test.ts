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
    expect(rows.at(-1)).toMatchObject({ action: 'deleted', data: { concept: 'Factura auditada' } })
    expect(rows.at(-1)!.actor_name).toBeTruthy()
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
