/** Tool MCP de resumen ejecutivo: compone métricas de todos los módulos. */

import { describe, test, expect, beforeEach } from 'vitest'
import { createMockSupabase } from '../helpers/supabase-mock'
import { getBusinessSummary } from '@/lib/mcp/tools/summary'
import { type Db } from '@/lib/mcp/shared'

const asDb = (c: ReturnType<typeof createMockSupabase>) => c as unknown as Db

beforeEach(() => {
  // Sin GITHUB_TOKEN/REPO → open_tasks es null sin tocar la red
  delete process.env.GITHUB_TOKEN
  delete process.env.GITHUB_REPO
})

describe('getBusinessSummary', () => {
  test('compone métricas de todos los módulos', async () => {
    const client = createMockSupabase({
      responses: {
        quotations: { data: [{ status: 'draft' }, { status: 'approved' }] },
        orders: { data: [{ status: 'ordered' }, { status: 'ordered' }, { status: 'completed' }] },
        store_inventory: { data: [{ quantity: 0 }, { quantity: 8 }] },
        etm_products: { data: null, count: 564 },
        urrea_catalog: { data: null, count: 1200 },
      },
    })

    const summary = await getBusinessSummary(asDb(client))

    expect(summary.quotations_by_status).toMatchObject({ draft: 1, approved: 1 })
    expect(summary.orders_by_status).toMatchObject({ ordered: 2, completed: 1 })
    expect(summary.inventory).toEqual({ total: 2, sin_stock: 1, low_stock: 0, in_stock: 1 })
    expect(summary.products_count).toBe(564)
    expect(summary.urrea_catalog_count).toBe(1200)
    expect(summary.open_tasks).toBeNull() // GitHub no configurado
  })

  test('un módulo que falla no tumba el resumen (degrada a null)', async () => {
    const client = createMockSupabase({
      responses: {
        quotations: { data: null, error: { message: 'boom' } },
        orders: { data: [] },
        store_inventory: { data: [] },
        etm_products: { data: null, count: 0 },
        urrea_catalog: { data: null, count: 0 },
      },
    })

    const summary = await getBusinessSummary(asDb(client))

    expect(summary.quotations_by_status).toBeNull()
    expect(summary.orders_by_status).toEqual({ ordered: 0, received: 0, delivered: 0, completed: 0, cancelled: 0 })
  })
})
