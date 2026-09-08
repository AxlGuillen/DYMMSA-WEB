/**
 * Browser E2E of the money flow: create order, then reception with excess through
 * the anti-typo dialog (#19). The backend is covered in integration; this is the wiring.
 */
import { test, expect } from '@playwright/test'
import { seedQuotation, sql, closePool } from '../integration/helpers/db'

test.afterAll(async () => { await closePool() })

test('generar orden (split de inventario) → recepción con excedente → +3 a tienda', async ({ page }) => {
  // Approved 60001 (stock 5) qty 12 → the order splits 5 in stock / 7 to order.
  const { id } = await seedQuotation({
    status: 'approved',
    items: [{ etm: 'OR-60001', model_code: '60001', brand: 'URREA', unit_price: 100, quantity: 12, is_approved: true, is_sold: true }],
  })

  await page.goto('/login')
  await page.locator('#email').fill('test@dymmsa.local')
  await page.locator('#password').fill('testpassword123')
  await page.getByRole('button', { name: 'Iniciar sesión' }).click()
  await page.waitForURL('**/dashboard**')

  await page.goto(`/dashboard/quotations/${id}`)
  await page.getByRole('button', { name: 'Generar Orden' }).click()
  await page.getByRole('button', { name: 'Sí, generar orden' }).click()
  await page.waitForURL('**/dashboard/orders/**')

  const [oi] = await sql<{ quantity_in_stock: number; quantity_to_order: number }>(
    "SELECT quantity_in_stock, quantity_to_order FROM order_items WHERE etm = 'OR-60001'",
  )
  expect(oi).toMatchObject({ quantity_in_stock: 5, quantity_to_order: 7 })

  // Reception with excess: 7 ordered, 10 arrive.
  const recibidas = page.getByRole('spinbutton').first() // the only editable input (to-order > 0)
  await recibidas.fill('10')
  await expect(page.getByText('+3 a tienda').first()).toBeVisible()

  // Anti-typo confirmation dialog (#19).
  await page.getByRole('button', { name: 'Confirmar Recepción' }).click()
  await expect(page.getByText('Sí, confirmar recepción')).toBeVisible()
  await page.getByRole('button', { name: 'Sí, confirmar recepción' }).click()

  // The excess (3) lands in inventory.
  await expect(page.getByText('Recepción confirmada')).toBeVisible() // toast
  await expect
    .poll(async () => Number((await sql<{ quantity: number }>("SELECT quantity FROM store_inventory WHERE model_code = '60001'"))[0].quantity))
    .toBe(3)
})
