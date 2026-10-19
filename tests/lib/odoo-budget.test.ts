/** Route budget for Odoo reads (review PR #150): degrade with an OdooError instead of a Vercel 504. */

import { describe, test, expect, vi, afterEach } from 'vitest'
import { ROUTE_ODOO_BUDGET_MS, withinBudget } from '@/lib/odoo/budget'
import { OdooError } from '@/lib/odoo/client'

afterEach(() => vi.useRealTimers())

describe('withinBudget', () => {
  test('deja pasar el resultado cuando Odoo responde a tiempo', async () => {
    await expect(withinBudget(Promise.resolve(42), 1000)).resolves.toBe(42)
  })

  test('pasado el presupuesto rechaza con OdooError (la ruta degrada en vez de dar 504)', async () => {
    vi.useFakeTimers()
    const pending = withinBudget(new Promise(() => {}), 1000)
    const assertion = expect(pending).rejects.toBeInstanceOf(OdooError)
    await vi.advanceTimersByTimeAsync(1000)
    await assertion
  })

  test('el presupuesto cabe con holgura en el maxDuration de 60 s de las rutas', () => {
    expect(ROUTE_ODOO_BUDGET_MS).toBeLessThanOrEqual(50_000)
  })
})
