/**
 * Quotation update against local Supabase (ADR-021): one transaction in update_quotation() that keeps
 * line ids (#157); a regression here loses customer decisions or leaves a half-written quotation.
 */
import { describe, test, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@supabase/supabase-js'
import { injectSupabaseAdmin, injectSupabaseServer } from '../helpers/setup'
import { makeRequest, makeParams } from '../helpers/request'
import { authedClient, serviceClient } from './helpers/clients'
import { resetDb, sql, seedQuotation, closePool, LOCAL } from './helpers/db'
import * as update from '@/app/api/quotations/[id]/update/route'
import * as approve from '@/app/api/approve/[token]/route'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))

let activeClient: SupabaseClient
injectSupabaseServer(() => activeClient as never)
injectSupabaseAdmin(() => serviceClient() as never)

beforeAll(async () => { activeClient = await authedClient() })
beforeEach(async () => { await resetDb() })
afterAll(async () => { await closePool() })

const patch = (id: string, body: unknown) =>
  update.PATCH(makeRequest(body, { method: 'PATCH' }), makeParams({ id }))
const approvePost = (token: string, body: unknown) =>
  approve.POST(makeRequest(body, { method: 'POST' }), makeParams({ token }))

const line = (etm: string, model_code: string, extra: Record<string, unknown> = {}) => ({
  item_type: 'product', etm, model_code, brand: 'URREA', unit_price: 100, quantity: 2, delivery_time: 'immediate', ...extra,
})

type Row = { id: string; etm: string; is_approved: boolean | null; sort_order: number }
const rowsOf = (id: string) =>
  sql<Row>('SELECT id, etm, is_approved, sort_order FROM quotation_items WHERE quotation_id = $1 ORDER BY sort_order', [id])

describe('PATCH /quotations/[id]/update (integración local)', () => {
  test('reabrir/editar PRESERVA is_approved vía _dbId (no pierde decisiones del cliente)', async () => {
    const { id, itemIds } = await seedQuotation({
      status: 'approved',
      items: [
        { etm: 'A', model_code: '60001', brand: 'URREA', unit_price: 100, quantity: 2, is_approved: true },
        { etm: 'B', model_code: '60002', brand: 'URREA', unit_price: 50, quantity: 1, is_approved: false },
      ],
    })

    // The UI resends existing items with _dbId and without is_approved, so the
    // persisted decision is the fallback.
    const res = await patch(id, {
      name: 'Editada', customer_name: 'ACME',
      items: [
        { _dbId: itemIds[0], item_type: 'product', etm: 'A', model_code: '60001', brand: 'URREA', unit_price: 100, quantity: 2, delivery_time: 'immediate' },
        { _dbId: itemIds[1], item_type: 'product', etm: 'B', model_code: '60002', brand: 'URREA', unit_price: 50, quantity: 1, delivery_time: 'immediate' },
        { _id: 'new', item_type: 'product', etm: 'C', model_code: '', brand: '', unit_price: 30, quantity: 5, delivery_time: 'immediate' },
      ],
    })
    expect(res.status).toBe(200)

    const items = await sql<{ etm: string; is_approved: boolean | null }>(
      'SELECT etm, is_approved FROM quotation_items WHERE quotation_id = $1 ORDER BY sort_order', [id],
    )
    expect(items).toEqual([
      { etm: 'A', is_approved: true },
      { etm: 'B', is_approved: false },
      { etm: 'C', is_approved: null },   // new → pending
    ])
  })

  test('REGLA (#157): conserva el id de cada línea que sigue, borra la quitada e inserta la nueva; todo con sort_order = índice', async () => {
    const { id, itemIds } = await seedQuotation({
      status: 'approved',
      items: [
        { etm: 'A', model_code: '60001', brand: 'URREA', unit_price: 100, quantity: 2, is_approved: true },
        { etm: 'B', model_code: '60002', brand: 'URREA', unit_price: 50, quantity: 1, is_approved: true },
        { etm: 'C', model_code: '60005', brand: 'TRUPER', unit_price: 25, quantity: 1, is_approved: false },
      ],
    })

    const res = await patch(id, {
      name: 'Editada', customer_name: 'ACME NUEVO',
      items: [
        line('C', '60005', { _dbId: itemIds[2], brand: 'TRUPER', unit_price: 25, quantity: 4, is_approved: false }),
        { _id: 'sep', item_type: 'separator', section_label: 'Obra Norte' },
        line('N', '', { _id: 'new', brand: '', unit_price: 10, quantity: 1, is_approved: null }),
        line('A', '60001', { _dbId: itemIds[0], unit_price: 120, is_approved: true }),
      ],
    })
    expect(res.status).toBe(200)

    const rows = await rowsOf(id)
    expect(rows.map((r) => r.etm ?? 'sep')).toEqual(['C', 'sep', 'N', 'A'])
    expect(rows.map((r) => r.sort_order)).toEqual([0, 1, 2, 3])
    expect(rows[0].id).toBe(itemIds[2])
    expect(rows[3].id).toBe(itemIds[0])
    expect(rows.some((r) => r.id === itemIds[1])).toBe(false) // B removed
    expect(new Set(rows.map((r) => r.id)).size).toBe(4)

    const [quotation] = await sql<{ customer_name: string; total_amount: string }>(
      'SELECT customer_name, total_amount FROM quotations WHERE id = $1', [id],
    )
    expect(quotation.customer_name).toBe('ACME NUEVO')
    expect(Number(quotation.total_amount)).toBe(25 * 4 + 10 + 120 * 2)
  })

  test('REGLA (#157): en revisión, la decisión que el cliente guardó gana sobre un editor abierto antes', async () => {
    const { id, itemIds } = await seedQuotation({
      status: 'sent_for_approval',
      items: [{ etm: 'A', model_code: '60001', brand: 'URREA', unit_price: 100, quantity: 2, is_approved: true }],
    })
    const res = await patch(id, {
      name: 'Q', customer_name: 'ACME',
      items: [line('A', '60001', { _dbId: itemIds[0], unit_price: 90, is_approved: null })],
    })
    expect(res.status).toBe(200)
    const [row] = await rowsOf(id)
    expect(row).toMatchObject({ id: itemIds[0], is_approved: true })
  })

  test('REGLA (#157): el cliente con la página abierta aprueba sin problema tras una edición que conserva sus líneas', async () => {
    const { id, token, itemIds } = await seedQuotation({
      status: 'sent_for_approval',
      items: [
        { etm: 'A', model_code: '60001', brand: 'URREA', unit_price: 100, quantity: 2 },
        { etm: 'B', model_code: '60002', brand: 'URREA', unit_price: 50, quantity: 1 },
      ],
    })
    // DYMMSA changes a price and adds a line; the client's page still holds the original ids.
    await patch(id, {
      name: 'Q', customer_name: 'ACME',
      items: [
        line('A', '60001', { _dbId: itemIds[0], unit_price: 95 }),
        line('B', '60002', { _dbId: itemIds[1], unit_price: 50, quantity: 1 }),
        line('N', '60005', { _id: 'new', brand: 'TRUPER' }),
      ],
    })
    const res = await approvePost(token, { approvedIds: [itemIds[0], itemIds[1]], finalize: true })
    expect(res.status).toBe(200)
    const rows = await rowsOf(id)
    expect(rows.map((r) => [r.etm, r.is_approved])).toEqual([['A', true], ['B', true], ['N', false]])
  })

  test('REGLA (#157): una actualización que falla a medias deja la cotización intacta (una sola transacción)', async () => {
    const { id, itemIds } = await seedQuotation({
      name: 'Original',
      status: 'approved',
      items: [
        { etm: 'A', model_code: '60001', brand: 'URREA', unit_price: 100, quantity: 2, is_approved: true },
        { etm: 'B', model_code: '60002', brand: 'URREA', unit_price: 50, quantity: 1, is_approved: true },
      ],
    })
    const before = await rowsOf(id)

    // Called directly, past the server validation: the header and line A are written before the new line
    // trips quotation_items_quantity_check, and the whole call must roll back.
    const { error } = await activeClient.rpc('update_quotation', {
      p_quotation_id: id,
      p_header: { name: 'A medias', customer_name: 'OTRO', total_amount: 1 },
      p_items: [
        { ...line('A', '60001'), id: itemIds[0], unit_price: 999, is_approved: false, is_sold: null, dymmsa_description: null },
        { ...line('X', '60001'), id: null, quantity: 0, is_approved: null, is_sold: null, dymmsa_description: null },
      ],
    })
    expect(error?.code).toBe('23514')

    expect(await rowsOf(id)).toEqual(before)
    const [quotation] = await sql<{ name: string }>('SELECT name FROM quotations WHERE id = $1', [id])
    expect(quotation.name).toBe('Original')
    const [a] = await sql<{ unit_price: string }>('SELECT unit_price FROM quotation_items WHERE id = $1', [itemIds[0]])
    expect(Number(a.unit_price)).toBe(100)
  })

  test('REGLA (#157): la ruta rechaza líneas inválidas en el server (400 + ETM) sin tocar la cotización', async () => {
    const { id } = await seedQuotation({
      status: 'draft',
      items: [{ etm: 'A', model_code: '60001', brand: 'URREA', unit_price: 100, quantity: 2, is_approved: true }],
    })
    const before = await rowsOf(id)
    const res = await patch(id, {
      name: 'X', customer_name: 'ACME',
      items: [line('A', '60001', { quantity: 0 })],
    })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ offendingEtm: 'A' })
    expect(await rowsOf(id)).toEqual(before)
  })

  test('REGLA (#157): los CHECK NOT VALID de entrega y tipo rechazan una fila nueva mala; la historia no se valida', async () => {
    const { id } = await seedQuotation({ items: [{ etm: 'A', quantity: 1, unit_price: 1 }] })
    await expect(sql(
      "INSERT INTO quotation_items (quotation_id, item_type, etm, quantity, delivery_time) VALUES ($1, 'product', 'X', 1, 'tomorrow')", [id],
    )).rejects.toThrow(/quotation_items_delivery_time_check/)
    await expect(sql(
      "INSERT INTO quotation_items (quotation_id, item_type, etm, quantity) VALUES ($1, 'note', 'X', 1)", [id],
    )).rejects.toThrow(/quotation_items_item_type_check/)
    // A separator keeps a NULL delivery_time.
    await sql("INSERT INTO quotation_items (quotation_id, item_type, delivery_time) VALUES ($1, 'separator', NULL)", [id])

    const checks = await sql<{ conname: string; convalidated: boolean }>(
      "SELECT conname, convalidated FROM pg_constraint WHERE conname IN ('quotation_items_delivery_time_check', 'quotation_items_item_type_check') ORDER BY conname",
    )
    expect(checks).toEqual([
      { conname: 'quotation_items_delivery_time_check', convalidated: false },
      { conname: 'quotation_items_item_type_check', convalidated: false },
    ])
  })

  test('privilegios: update_quotation no es para anon; submit_quotation_approval solo para service_role', async () => {
    const anon = createClient(LOCAL.url, LOCAL.anon, { auth: { persistSession: false, autoRefreshToken: false } })
    const { id, token } = await seedQuotation({ status: 'sent_for_approval', items: [{ etm: 'A', quantity: 1, unit_price: 1 }] })

    const asAnon = await anon.rpc('update_quotation', { p_quotation_id: id, p_header: {}, p_items: [] })
    expect(asAnon.error?.code).toBe('42501')
    const asSession = await activeClient.rpc('submit_quotation_approval', { p_token: token, p_approved_ids: [], p_finalize: true })
    expect(asSession.error?.code).toBe('42501')

    const [quotation] = await sql<{ status: string }>('SELECT status FROM quotations WHERE id = $1', [id])
    expect(quotation.status).toBe('sent_for_approval')
  })

  test('re-resuelve y congela la Desc. DYMMSA del catálogo real al editar', async () => {
    const { id, itemIds } = await seedQuotation({
      status: 'approved',
      items: [{ etm: 'A', model_code: '60001', brand: 'URREA', unit_price: 100, quantity: 1, is_approved: true }],
    })
    await patch(id, {
      name: 'Editada', customer_name: 'ACME',
      items: [{ _dbId: itemIds[0], item_type: 'product', etm: 'A', model_code: '60001', brand: 'URREA', unit_price: 100, quantity: 1, delivery_time: 'immediate' }],
    })
    const [item] = await sql<{ dymmsa_description: string | null }>('SELECT dymmsa_description FROM quotation_items WHERE quotation_id = $1', [id])
    expect(item.dymmsa_description).toBe('Botador de cobre 30/300mm (oficial URREA)')
  })

  test('el snapshot oficial que reenvía el detalle no se copia a etm_products; la curada sí se aprende', async () => {
    const { id, itemIds } = await seedQuotation({
      status: 'approved',
      items: [
        { etm: 'SEED-URREA-1', model_code: '60001', brand: 'URREA', unit_price: 100, quantity: 1, is_approved: true },
        { etm: 'SEED-LOCAL', model_code: '60005', brand: 'TRUPER', unit_price: 25, quantity: 1, is_approved: true },
      ],
    })
    // QuotationDetail resends the resolved snapshot in dymmsa_description.
    const res = await patch(id, {
      name: 'Editada', customer_name: 'ACME',
      items: [
        { _dbId: itemIds[0], item_type: 'product', etm: 'SEED-URREA-1', model_code: '60001', brand: 'URREA', unit_price: 100, quantity: 1, delivery_time: 'immediate', dymmsa_description: 'Botador de cobre 30/300mm (oficial URREA)' },
        { _dbId: itemIds[1], item_type: 'product', etm: 'SEED-LOCAL', model_code: '60005', brand: 'TRUPER', unit_price: 25, quantity: 1, delivery_time: 'immediate', dymmsa_description: 'Herramienta local v2' },
      ],
    })
    expect(res.status).toBe(200)
    expect(await res.json()).not.toHaveProperty('warning') // auto-learn did run

    const products = await sql<{ etm: string; dymmsa_description: string | null }>(
      "SELECT etm, dymmsa_description FROM etm_products WHERE etm IN ('SEED-URREA-1', 'SEED-LOCAL') ORDER BY etm",
    )
    expect(products).toEqual([
      { etm: 'SEED-LOCAL', dymmsa_description: 'Herramienta local v2' },
      { etm: 'SEED-URREA-1', dymmsa_description: null }, // ADR-013 rule 1: stays empty
    ])
  })

  test('un snapshot reenviado sin cambios no pisa la curada de etm_products', async () => {
    const { id, itemIds } = await seedQuotation({
      status: 'approved',
      items: [{ etm: 'SEED-LOCAL', model_code: '60005', brand: 'TRUPER', unit_price: 25, quantity: 1, is_approved: true }],
    })
    // An older snapshot: BD ETM was curated again after this quotation was saved.
    await sql('UPDATE quotation_items SET dymmsa_description = $1 WHERE id = $2', ['Texto viejo del snapshot', itemIds[0]])

    const res = await patch(id, {
      name: 'Editada', customer_name: 'ACME',
      items: [
        { _dbId: itemIds[0], item_type: 'product', etm: 'SEED-LOCAL', model_code: '60005', brand: 'TRUPER', unit_price: 25, quantity: 3, delivery_time: 'immediate', dymmsa_description: 'Texto viejo del snapshot' },
      ],
    })
    expect(res.status).toBe(200)

    const [product] = await sql<{ dymmsa_description: string | null }>(
      "SELECT dymmsa_description FROM etm_products WHERE etm = 'SEED-LOCAL'",
    )
    expect(product.dymmsa_description).toBe('Herramienta local (curada)')
    const [item] = await sql<{ id: string; dymmsa_description: string | null }>(
      'SELECT id, dymmsa_description FROM quotation_items WHERE quotation_id = $1', [id],
    )
    expect(item).toEqual({ id: itemIds[0], dymmsa_description: 'Texto viejo del snapshot' }) // ADR-013 rule 2: frozen
  })
})
