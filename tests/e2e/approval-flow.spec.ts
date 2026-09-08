/**
 * Browser E2E of the public approval page: the only screen an outside customer
 * uses unsupervised, so a break there surfaces as a complaint, not a failure.
 */
import { test, expect } from '@playwright/test'
import { seedQuotation, sql, closePool } from '../integration/helpers/db'

test.afterAll(async () => { await closePool() })

test('aprobación: filtrar por marca → aprobar todos → enviar → pantalla de éxito', async ({ page }) => {
  // Fixture: quotation under review with two brands.
  const { id, token } = await seedQuotation({
    status: 'sent_for_approval',
    items: [
      { item_type: 'separator', section_label: 'Proyecto A' },
      { etm: 'AP-URREA-1', model_code: '60001', brand: 'URREA', unit_price: 100, quantity: 2, is_sold: true },
      { etm: 'AP-URREA-2', model_code: '60002', brand: 'URREA', unit_price: 50, quantity: 1, is_sold: true },
      { etm: 'AP-SURTEK-1', model_code: '60003', brand: 'SURTEK', unit_price: 30, quantity: 3, is_sold: true },
    ],
  })

  // Skip the 1.9s intro splash to keep the test deterministic.
  await page.addInitScript(() => sessionStorage.setItem('dymmsa-approval-splash', '1'))
  await page.goto(`/approve/${token}`)

  await expect(page.getByText('AP-URREA-1')).toBeVisible()
  await expect(page.getByText('AP-SURTEK-1')).toBeVisible()

  // Brand filter (#24): SURTEK hides the URREA rows.
  await page.getByRole('combobox').first().click()
  await page.getByRole('option', { name: 'SURTEK' }).click()
  await expect(page.getByText('AP-SURTEK-1')).toBeVisible()
  await expect(page.getByText('AP-URREA-1')).toHaveCount(0)

  await page.getByRole('combobox').first().click()
  await page.getByRole('option', { name: 'Todas las marcas' }).click()
  await expect(page.getByText('AP-URREA-1')).toBeVisible()

  await page.getByRole('button', { name: 'Aprobar todos' }).click()
  await page.getByRole('button', { name: 'Enviar aprobación' }).click()
  // Confirmation popup guards against sending by accident.
  await expect(page.getByText('¿Enviar tu aprobación?')).toBeVisible()
  await page.getByRole('button', { name: 'Sí, enviar aprobación' }).click()

  await expect(page.getByText('¡Aprobación enviada!')).toBeVisible()
  const [q] = await sql<{ status: string; approved_at: string | null }>(
    'SELECT status, approved_at FROM quotations WHERE id = $1', [id],
  )
  expect(q.status).toBe('approved')
  expect(q.approved_at).not.toBeNull()
})
