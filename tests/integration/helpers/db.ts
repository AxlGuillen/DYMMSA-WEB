/**
 * Acceso directo a la BD LOCAL de pruebas (pg) para setup/reset/aserciones
 * de los tests de integración (Fase C1). Corre contra el Supabase local
 * (`bunx supabase start`); NUNCA contra la nube.
 */
import { Pool } from 'pg'

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
 * Fixtures de negocio — DEBEN espejar `supabase/seed.sql` (mismos valores).
 * Se re-aplican en cada test para aislar (auto-learn y create-order mutan
 * etm_products/store_inventory).
 */
const FIXTURES_SQL = `
  DELETE FROM public.etm_products;
  DELETE FROM public.urrea_catalog;
  DELETE FROM public.store_inventory;
  INSERT INTO public.etm_products (etm, description, description_es, model_code, price, brand, is_sold, dymmsa_description) VALUES
    ('SEED-URREA-1','Copper punch 30mm','Botador de cobre 30mm','60001',100,'URREA',true,NULL),
    ('SEED-URREA-2','Locking pliers 10in','Pinza de presion 10"','60002', 50,'URREA',true,NULL),
    ('SEED-SURTEK-1','Tape measure 5m','Cinta metrica 5m','60003', 30,'SURTEK',NULL,NULL),
    ('SEED-NOSELL','Item we do not sell','No lo vendemos','60004',NULL,'URREA',false,NULL),
    ('SEED-LOCAL','Local buy no catalog','Compra local sin catalogo','60005', 25,'TRUPER',true,'Herramienta local (curada)');
  INSERT INTO public.urrea_catalog (code, brand, description, std) VALUES
    ('60001','URREA','Botador de cobre 30/300mm (oficial URREA)',10),
    ('60002','URREA','Pinza de presion 10" (oficial URREA)',6),
    ('60003','SURTEK','Cinta metrica 5m (oficial SURTEK)',1);
  INSERT INTO public.store_inventory (model_code, quantity, location) VALUES
    ('60001',5,'Gaveta S1');
`

/**
 * Restaura la BD al estado del seed para las tablas que los tests mutan:
 * borra lo transaccional (cotizaciones/órdenes/decisiones) y reaplica los
 * fixtures de catálogo/inventario. El usuario de auth y el resto se conservan.
 */
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

/**
 * Inserta una cotización + sus ítems vía SQL directo (arreglo de estado para
 * los tests de capas 2-5). Devuelve id, approval_token y los ids de ítems en
 * orden. sort_order = índice del array.
 */
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

export async function resetDb(): Promise<void> {
  await getPool().query(`
    TRUNCATE public.quotations, public.orders, public.order_purchase_decisions,
             public.suppliers, public.brands, public.supplier_brands
      RESTART IDENTITY CASCADE;
    ${FIXTURES_SQL}
  `)
}
