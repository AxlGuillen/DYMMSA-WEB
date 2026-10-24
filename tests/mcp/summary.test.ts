/** MCP executive summary tool: composes metrics from every module. */

import { describe, test, expect, beforeEach } from 'vitest'
import { createMockSupabase } from '../helpers/supabase-mock'
import { getBusinessSummary } from '@/lib/mcp/tools/summary'
import type { Db } from '@/lib/mcp/core/db'

const asDb = (c: ReturnType<typeof createMockSupabase>) => c as unknown as Db

beforeEach(() => {
  // No GITHUB_TOKEN/REPO → open_tasks is null without touching the network
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

    expect(summary.cotizaciones_por_estado).toMatchObject({ borrador: 1, aprobada: 1 })
    expect(summary.ordenes_por_estado).toMatchObject({ pedida: 2, completada: 1 })
    expect(summary.inventario).toEqual({ total: 2, sin_existencia: 1, poca: 0, suficiente: 1 })
    expect(summary.productos_etm).toBe(564)
    expect(summary.catalogo_urrea).toBe(1200)
    expect(summary.tareas_abiertas).toBeNull() // GitHub not configured
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

    expect(summary.cotizaciones_por_estado).toBeNull()
    expect(summary.ordenes_por_estado).toEqual({ pedida: 0, recibida: 0, entregada: 0, completada: 0, cancelada: 0 })
  })
})
