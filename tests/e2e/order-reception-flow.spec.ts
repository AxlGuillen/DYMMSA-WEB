/**
 * E2E de navegador (Tier 2) — el flujo de dinero en la UI: generar orden desde
 * una cotización aprobada → registrar recepción con EXCEDENTE pasando por el
 * diálogo anti-dedazo (#19). El backend ya está en integración; esto cubre el
 * cableado visual (botones, el input de recibidas, el diálogo de confirmación)
 * de las features recientes #19/#20 que nada más probaba.
 *
 * Requiere `bunx supabase start`. Correr con: bun run test:e2e
 */
import { test, expect } from '@playwright/test'
import { seedQuotation, sql, closePool } from '../integration/helpers/db'

test.afterAll(async () => { await closePool() })

test('generar orden (split de inventario) → recepción con excedente → +3 a tienda', async ({ page }) => {
  // Cotización APROBADA con 60001 (stock 5) aprobado qty 12 → al generar la
  // orden: 5 en stock / 7 a pedir.
  const { id } = await seedQuotation({
    status: 'approved',
    items: [{ etm: 'OR-60001', model_code: '60001', brand: 'URREA', unit_price: 100, quantity: 12, is_approved: true, is_sold: true }],
  })

  // ── Login ────────────────────────────────────────────────────────────────
  await page.goto('/login')
  await page.locator('#email').fill('test@dymmsa.local')
  await page.locator('#password').fill('testpassword123')
  await page.getByRole('button', { name: 'Iniciar sesión' }).click()
  await page.waitForURL('**/dashboard**')

  // ── Generar orden desde el detalle de la cotización ───────────────────────
  await page.goto(`/dashboard/quotations/${id}`)
  await page.getByRole('button', { name: 'Generar Orden' }).click()
  await page.getByRole('button', { name: 'Sí, generar orden' }).click()
  await page.waitForURL('**/dashboard/orders/**') // redirige al detalle de la orden

  // El split quedó bien en la BD: 5 en stock / 7 a pedir; inventario deducido a 0.
  const [oi] = await sql<{ quantity_in_stock: number; quantity_to_order: number }>(
    "SELECT quantity_in_stock, quantity_to_order FROM order_items WHERE etm = 'OR-60001'",
  )
  expect(oi).toMatchObject({ quantity_in_stock: 5, quantity_to_order: 7 })

  // ── Recepción con excedente: pediste 7, llegan 10 ─────────────────────────
  const recibidas = page.getByRole('spinbutton').first() // único input editable (a pedir > 0)
  await recibidas.fill('10')
  // El aviso "+3 a tienda" aparece en vivo bajo el input.
  await expect(page.getByText('+3 a tienda').first()).toBeVisible()

  // Confirmar → diálogo anti-dedazo (#19) → confirmar.
  await page.getByRole('button', { name: 'Confirmar Recepción' }).click()
  await expect(page.getByText('Sí, confirmar recepción')).toBeVisible()
  await page.getByRole('button', { name: 'Sí, confirmar recepción' }).click()

  // ── El excedente (3) entró al inventario en la BD real ────────────────────
  await expect(page.getByText('Recepción confirmada')).toBeVisible() // toast
  await expect
    .poll(async () => Number((await sql<{ quantity: number }>("SELECT quantity FROM store_inventory WHERE model_code = '60001'"))[0].quantity))
    .toBe(3)
})
