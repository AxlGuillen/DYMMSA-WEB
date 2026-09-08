/**
 * Browser E2E for the products table (#55): the drag handle needs real layout
 * and geometry, and width persistence only shows on a real reload.
 */
import { test, expect } from '@playwright/test'
import { sql, closePool } from '../integration/helpers/db'

test.afterAll(async () => { await closePool() })

test('productos: ensanchar columna (persiste), acciones a un click, toggle is_sold', async ({ page }) => {
  await page.goto('/login')
  await page.locator('#email').fill('test@dymmsa.local')
  await page.locator('#password').fill('testpassword123')
  await page.getByRole('button', { name: 'Iniciar sesión' }).click()
  await page.waitForURL('**/dashboard**')

  await page.goto('/dashboard/db')
  await expect(page.getByText('SEED-URREA-1')).toBeVisible()

  // Actions on the FIRST click: visible without hover or a "..." menu.
  await expect(page.getByRole('button', { name: 'Editar SEED-URREA-1' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Eliminar SEED-URREA-1' })).toBeVisible()

  const head = page.getByRole('columnheader').filter({ hasText: 'Descripcion' }).first()
  const before = (await head.boundingBox())!.width
  const grip = (await head.getByRole('separator').boundingBox())!
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2)
  await page.mouse.down()
  await page.mouse.move(grip.x + grip.width / 2 + 180, grip.y + grip.height / 2, { steps: 12 })
  await page.mouse.up()

  const after = (await head.boundingBox())!.width
  expect(after).toBeGreaterThan(before + 100)

  // The width survives a reload, which is the whole point of saving it.
  await page.reload()
  await expect(page.getByText('SEED-URREA-1')).toBeVisible()
  const afterReload = (await page.getByRole('columnheader')
    .filter({ hasText: 'Descripcion' }).first().boundingBox())!.width
  expect(Math.abs(afterReload - after)).toBeLessThan(5)

  // Tri-state toggle against the real DB: null → false → null.
  const soldOf = async () =>
    (await sql<{ is_sold: boolean | null }>(
      "SELECT is_sold FROM etm_products WHERE etm = 'SEED-SURTEK-1'"))[0].is_sold
  expect(await soldOf()).toBeNull()

  const row = page.getByRole('row').filter({ hasText: 'SEED-SURTEK-1' })
  await row.getByRole('button', { name: 'Marcar: no se vende' }).click()
  await expect.poll(soldOf).toBe(false)

  // Clicking the ALREADY ACTIVE button goes back to undefined; without it a
  // mistaken mark would be irreversible from the table.
  await row.getByRole('button', { name: 'Quitar "no se vende"' }).click()
  await expect.poll(soldOf).toBeNull()
})
