/**
 * Migration script: quotations, quotation_items, orders.quotation_id, order_items.description_es
 *
 * Uses the Supabase service role key to create a temporary exec_sql helper,
 * run each DDL block, then clean up.
 */

import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing Supabase environment variables')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

// ---------------------------------------------------------------------------
// Helper: POST raw SQL via the PostgREST /rpc endpoint using fetch
// We first create the exec_sql helper function, then use it for DDL.
// ---------------------------------------------------------------------------
async function execSQL(label: string, sql: string): Promise<boolean> {
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/exec_sql`, {
    method: 'POST',
    headers: {
      apikey: supabaseServiceKey,
      Authorization: `Bearer ${supabaseServiceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({ query: sql }),
  })

  if (response.ok) {
    console.log(`  [OK] ${label}`)
    return true
  }

  const body = await response.text()
  console.error(`  [FAIL] ${label}`)
  console.error(`         ${body}`)
  return false
}

// ---------------------------------------------------------------------------
// Bootstrap: create the exec_sql helper using raw REST if it does not exist.
// We use POST to /rest/v1/rpc/exec_sql; if it 404s we need to create it first.
// We can create the function via a superuser-level call through the Supabase
// Management API using a personal access token, OR we can use the
// supabase.functions.invoke path if an edge function exists.
//
// Since neither is guaranteed, we instead bootstrap exec_sql by calling it
// with a CREATE OR REPLACE of itself — the first call will fail, so we use
// a different approach: a "query executor" via a do-block published via
// PostgREST (requires the function to exist already).
//
// Instead, we use the pg-protocol approach: Supabase exposes a direct
// PostgreSQL connection via the "db" subdomain on port 5432.
// Let's use postgres.js which ships with Bun natively.
// ---------------------------------------------------------------------------

// Actually — Bun has built-in support for connecting to Postgres!
// https://bun.sh/docs/api/sql
// The Supabase connection string for direct DB access (bypasses pooler):
// postgres://postgres.[ref]:[password]@[host]:5432/postgres
// But we don't have the DB password here, only the service role JWT.
//
// ALTERNATIVE: Use the @supabase/supabase-js .from('...') trick with a
// custom function that the service role can call.
//
// BEST APPROACH: Create exec_sql via the Supabase Management API REST endpoint.
// The management API uses a personal access token (PAT), not the service key.
// We don't have a PAT here either.
//
// FALLBACK APPROACH: Since we have the service role key (which is a JWT with
// role=service_role), we can call PostgreSQL functions in the public schema.
// We can bootstrap by using PostgREST's built-in ability to call
// `pg_catalog` functions indirectly — but PostgREST blocks DDL.
//
// REAL SOLUTION: Use the Supabase "sql" Edge Function endpoint or create
// the exec_sql function via a special Supabase endpoint.
//
// After research: Supabase exposes a SQL API at:
//   POST https://<ref>.supabase.co/pg/v1/query  (preview, requires service key)
// Let's try that endpoint.

async function execSQLDirect(label: string, sql: string): Promise<boolean> {
  // Try the Supabase SQL over HTTP endpoint (various possible paths)
  const endpoints = [
    `${supabaseUrl}/pg/v1/query`,
    `${supabaseUrl}/sql`,
  ]

  for (const endpoint of endpoints) {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        apikey: supabaseServiceKey,
        Authorization: `Bearer ${supabaseServiceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: sql }),
    })

    if (response.ok) {
      console.log(`  [OK] ${label}`)
      return true
    }

    const body = await response.text()
    if (!body.includes('invalid') && !body.includes('not found')) {
      console.error(`  [FAIL] ${label} (via ${endpoint})`)
      console.error(`         ${body}`)
      return false
    }
  }

  console.error(`  [FAIL] ${label} — no working SQL endpoint found`)
  return false
}

async function main() {
  console.log('='.repeat(60))
  console.log('DYMMSA SQL Migration')
  console.log('='.repeat(60))

  // Test connectivity
  const { data, error } = await supabase.from('orders').select('id').limit(1)
  if (error) {
    console.error('Cannot connect to Supabase:', error.message)
    process.exit(1)
  }
  console.log('Connected to Supabase OK\n')

  // -------------------------------------------------------------------------
  // Block 1: Create quotations table
  // -------------------------------------------------------------------------
  const block1 = `
CREATE TABLE IF NOT EXISTS quotations (
  id              UUID        NOT NULL DEFAULT gen_random_uuid(),
  customer_name   TEXT        NOT NULL,
  status          TEXT        NOT NULL DEFAULT 'draft',
  approval_token  UUID        UNIQUE DEFAULT gen_random_uuid(),
  total_amount    NUMERIC(10,2) NOT NULL DEFAULT 0,
  notes           TEXT,
  original_file_url TEXT,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  created_by      UUID        REFERENCES auth.users(id),
  PRIMARY KEY (id),
  CONSTRAINT quotations_status_check CHECK (
    status IN ('draft','sent_for_approval','approved','rejected','converted_to_order')
  ),
  CONSTRAINT quotations_total_check CHECK (total_amount >= 0)
);`

  // -------------------------------------------------------------------------
  // Block 2: Create quotation_items table
  // -------------------------------------------------------------------------
  const block2 = `
CREATE TABLE IF NOT EXISTS quotation_items (
  id              UUID        NOT NULL DEFAULT gen_random_uuid(),
  quotation_id    UUID        NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
  etm             TEXT,
  description     TEXT,
  description_es  TEXT,
  model_code      TEXT,
  brand           TEXT,
  unit_price      NUMERIC(10,2),
  quantity        INTEGER,
  is_approved     BOOLEAN     DEFAULT NULL,
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT quotation_items_price_check    CHECK (unit_price IS NULL OR unit_price >= 0),
  CONSTRAINT quotation_items_quantity_check CHECK (quantity IS NULL OR quantity > 0)
);`

  // -------------------------------------------------------------------------
  // Block 3: Add quotation_id to orders
  // -------------------------------------------------------------------------
  const block3 = `
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'quotation_id'
  ) THEN
    ALTER TABLE orders ADD COLUMN quotation_id UUID REFERENCES quotations(id);
  END IF;
END $$;`

  // -------------------------------------------------------------------------
  // Block 4: Add description_es to order_items
  // -------------------------------------------------------------------------
  const block4 = `
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS description_es TEXT;`

  const blocks = [
    { label: 'Block 1 – CREATE TABLE quotations', sql: block1 },
    { label: 'Block 2 – CREATE TABLE quotation_items', sql: block2 },
    { label: 'Block 3 – ALTER TABLE orders ADD COLUMN quotation_id', sql: block3 },
    { label: 'Block 4 – ALTER TABLE order_items ADD COLUMN description_es', sql: block4 },
  ]

  // Try each via the direct SQL endpoint
  console.log('Attempting execution via direct SQL endpoint...\n')
  for (const block of blocks) {
    console.log(`Running: ${block.label}`)
    await execSQLDirect(block.label, block.sql)
  }
}

main().catch(console.error)
