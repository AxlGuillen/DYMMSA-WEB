/** Direct pg access to the LOCAL test DB for setup/reset/assertions. Never the cloud. */
import { Pool } from 'pg'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export const LOCAL = {
  url: process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321',
  anon:
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0',
  service:
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU',
  dbUrl: process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  user: { email: 'test@dymmsa.local', password: 'testpassword123' },
}

let pool: Pool | null = null
export function getPool(): Pool {
  if (!pool) pool = new Pool({ connectionString: LOCAL.dbUrl, max: 4 })
  return pool
}

export async function sql<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  const { rows } = await getPool().query(text, params)
  return rows as T[]
}

export async function closePool(): Promise<void> {
  if (pool) { await pool.end(); pool = null }
}

/**
 * Fixtures are read from `supabase/seed.sql` itself: duplicating the INSERTs
 * would drift silently. Only the block after the marker; auth is not re-run.
 */
// Both runners (Vitest ESM, Playwright CJS) start from the repo root.
const SEED_PATH = join(process.cwd(), 'supabase/seed.sql')
const FIXTURES_MARKER = '-- ─── Fixtures de negocio'

function loadFixturesSql(): string {
  const seed = readFileSync(SEED_PATH, 'utf8')
  const idx = seed.indexOf(FIXTURES_MARKER)
  if (idx === -1) throw new Error(`No se encontró el marcador de fixtures en ${SEED_PATH}`)
  return `
    DELETE FROM public.etm_products;
    DELETE FROM public.urrea_catalog;
    DELETE FROM public.store_inventory;
    ${seed.slice(idx)}
  `
}

const FIXTURES_SQL = loadFixturesSql()

export interface SeedItem {
  item_type?: 'product' | 'separator'
  etm?: string
  model_code?: string
  brand?: string
  unit_price?: number | null
  quantity?: number | null
  is_approved?: boolean | null
  is_sold?: boolean | null
  section_label?: string | null
}

/** Inserts a quotation + items via raw SQL. sort_order = array index. */
export async function seedQuotation(opts: {
  name?: string
  customer?: string
  status?: string
  items: SeedItem[]
}): Promise<{ id: string; token: string; itemIds: string[] }> {
  const [q] = await sql<{ id: string; approval_token: string }>(
    `INSERT INTO quotations (name, customer_name, status)
     VALUES ($1, $2, $3) RETURNING id, approval_token`,
    [opts.name ?? 'Q Test', opts.customer ?? 'ACME', opts.status ?? 'draft'],
  )
  const itemIds: string[] = []
  for (let i = 0; i < opts.items.length; i++) {
    const it = opts.items[i]
    const sep = it.item_type === 'separator'
    const [row] = await sql<{ id: string }>(
      `INSERT INTO quotation_items
        (quotation_id, item_type, section_label, etm, model_code, brand,
         unit_price, quantity, is_approved, is_sold, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [
        q.id,
        it.item_type ?? 'product',
        sep ? (it.section_label ?? '') : null,
        sep ? null : (it.etm ?? null),
        sep ? null : (it.model_code ?? null),
        sep ? null : (it.brand ?? null),
        sep ? null : (it.unit_price ?? null),
        sep ? null : (it.quantity ?? null),
        sep ? null : (it.is_approved ?? null),
        sep ? null : (it.is_sold ?? null),
        i,
      ],
    )
    itemIds.push(row.id)
  }
  return { id: q.id, token: q.approval_token, itemIds }
}

/** Truncates the transactional tables and reapplies the seed fixtures; the auth user survives. */
export async function resetDb(): Promise<void> {
  await getPool().query(`
    TRUNCATE public.quotations, public.orders, public.order_purchase_decisions,
             public.suppliers, public.brands, public.supplier_brands
      RESTART IDENTITY CASCADE;
    ${FIXTURES_SQL}
  `)
}
