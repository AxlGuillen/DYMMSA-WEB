/**
 * E2E de navegador (Tier 2) — la página pública de aprobación `/approve/[token]`.
 * Es la ÚNICA pantalla que usa un cliente externo sin supervisión: si se rompe,
 * no te enteras hasta que un cliente se queja. Cubre el flujo #24: filtrar por
 * marca → aprobar → enviar (con confirmación) → pantalla de éxito, y verifica la
 * transición de estado en la BD real.
 *
 * Requiere `bunx supabase start`. Correr con: bun run test:e2e
 */
import { test, expect } from '@playwright/test'
import { seedQuotation, sql, closePool } from '../integration/helpers/db'

test.afterAll(async () => { await closePool() })

test('aprobación: filtrar por marca → aprobar todos → enviar → pantalla de éxito', async ({ page }) => {
  // ── Arreglo: cotización en revisión con 2 marcas bajo un proyecto ───────
  const { id, token } = await seedQuotation({
    status: 'sent_for_approval',
    items: [
      { item_type: 'separator', section_label: 'Proyecto A' },
      { etm: 'AP-URREA-1', model_code: '60001', brand: 'URREA', unit_price: 100, quantity: 2, is_sold: true },
      { etm: 'AP-URREA-2', model_code: '60002', brand: 'URREA', unit_price: 50, quantity: 1, is_sold: true },
      { etm: 'AP-SURTEK-1', model_code: '60003', brand: 'SURTEK', unit_price: 30, quantity: 3, is_sold: true },
    ],
  })

  // Salta el splash intro (1.9s) para un test determinista.
  await page.addInitScript(() => sessionStorage.setItem('dymmsa-approval-splash', '1'))
  await page.goto(`/approve/${token}`)

  // Página pública (sin login) cargó con los productos.
  await expect(page.getByText('AP-URREA-1')).toBeVisible()
  await expect(page.getByText('AP-SURTEK-1')).toBeVisible()

  // ── Filtro por marca (issue #24): SURTEK oculta las filas URREA ─────────
  await page.getByRole('combobox').first().click()
  await page.getByRole('option', { name: 'SURTEK' }).click()
  await expect(page.getByText('AP-SURTEK-1')).toBeVisible()
  await expect(page.getByText('AP-URREA-1')).toHaveCount(0) // filtrada fuera

  // Limpiar el filtro → vuelven todas.
  await page.getByRole('combobox').first().click()
  await page.getByRole('option', { name: 'Todas las marcas' }).click()
  await expect(page.getByText('AP-URREA-1')).toBeVisible()

  // ── Aprobar todos → enviar (con confirmación) ───────────────────────────
  await page.getByRole('button', { name: 'Aprobar todos' }).click()
  await page.getByRole('button', { name: 'Enviar aprobación' }).click()
  // Popup de confirmación anti-envío-por-error.
  await expect(page.getByText('¿Enviar tu aprobación?')).toBeVisible()
  await page.getByRole('button', { name: 'Sí, enviar aprobación' }).click()

  // ── Pantalla de éxito + estado real en la BD ────────────────────────────
  await expect(page.getByText('¡Aprobación enviada!')).toBeVisible()
  const [q] = await sql<{ status: string; approved_at: string | null }>(
    'SELECT status, approved_at FROM quotations WHERE id = $1', [id],
  )
  expect(q.status).toBe('approved')
  expect(q.approved_at).not.toBeNull()
})
