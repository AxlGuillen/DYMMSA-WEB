/**
 * E2E de navegador (Tier 2) — UX de la tabla de productos (issue #55).
 *
 * Cubre lo que jsdom NO puede: el arrastre real de la manija depende de layout
 * y geometría (boundingBox), y la persistencia del ancho solo se comprueba
 * recargando de verdad. Los tests unitarios cubren el clamp y el tri-estado;
 * esto cubre que el gesto funcione en un navegador.
 *
 * Requiere `bunx supabase start`. Correr con: bun run test:e2e
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

  // ── Acciones al PRIMER click: visibles sin hover ni menú "···" ──────────
  await expect(page.getByRole('button', { name: 'Editar SEED-URREA-1' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Eliminar SEED-URREA-1' })).toBeVisible()

  // ── Arrastrar la manija de "Descripcion" la ensancha ────────────────────
  const head = page.getByRole('columnheader').filter({ hasText: 'Descripcion' }).first()
  const before = (await head.boundingBox())!.width
  const grip = (await head.getByRole('separator').boundingBox())!
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2)
  await page.mouse.down()
  await page.mouse.move(grip.x + grip.width / 2 + 180, grip.y + grip.height / 2, { steps: 12 })
  await page.mouse.up()

  const after = (await head.boundingBox())!.width
  expect(after).toBeGreaterThan(before + 100)

  // El ancho sobrevive al reload (localStorage), que es el punto de guardarlo.
  await page.reload()
  await expect(page.getByText('SEED-URREA-1')).toBeVisible()
  const afterReload = (await page.getByRole('columnheader')
    .filter({ hasText: 'Descripcion' }).first().boundingBox())!.width
  expect(Math.abs(afterReload - after)).toBeLessThan(5)

  // ── Toggle tri-estado contra la BD real: null → false → null ────────────
  const soldOf = async () =>
    (await sql<{ is_sold: boolean | null }>(
      "SELECT is_sold FROM etm_products WHERE etm = 'SEED-SURTEK-1'"))[0].is_sold
  expect(await soldOf()).toBeNull() // fixture arranca sin definir

  const row = page.getByRole('row').filter({ hasText: 'SEED-SURTEK-1' })
  await row.getByRole('button', { name: 'Marcar: no se vende' }).click()
  await expect.poll(soldOf).toBe(false)

  // Click en el botón YA ACTIVO regresa a "sin definir" — sin esto una marca
  // por error sería irreversible desde la tabla.
  await row.getByRole('button', { name: 'Quitar "no se vende"' }).click()
  await expect.poll(soldOf).toBeNull()
})
