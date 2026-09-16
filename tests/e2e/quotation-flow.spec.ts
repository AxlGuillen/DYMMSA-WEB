/**
 * Browser E2E of what only a browser covers: real login, Excel upload,
 * client-side quoter state and save.
 */
import { test, expect } from '@playwright/test'
import * as XLSX from 'xlsx'

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

/** Real in-memory .xlsx with ETMs that exist in the local fixtures. */
function excelBuffer(rows: Record<string, unknown>[]): Buffer {
  const ws = XLSX.utils.json_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Cotizacion')
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}

test('login → subir Excel → cotizador poblado → guardar cotización', async ({ page }) => {
  await page.goto('/login')
  await page.locator('#email').fill('test@dymmsa.local')
  await page.locator('#password').fill('testpassword123')
  await page.getByRole('button', { name: 'Iniciar sesión' }).click()
  await page.waitForURL('**/dashboard**')

  await page.goto('/dashboard/quoter')
  const buffer = excelBuffer([
    { ETM: 'SEED-URREA-1', codigo_modelo: '60001', marca: 'URREA', cantidad: 2, precio: 100 },
    { ETM: 'SEED-URREA-2', codigo_modelo: '60002', marca: 'URREA', cantidad: 3, precio: 50 },
  ])
  await page
    .locator('input[aria-label="Seleccionar archivo Excel"]')
    .setInputFiles({ name: 'e2e.xlsx', mimeType: XLSX_MIME, buffer })
  // The uploader is two-step: select, then process (parse + lookup).
  await page.getByRole('button', { name: 'Procesar archivo' }).click()

  await expect(page.getByText('SEED-URREA-1')).toBeVisible()
  await expect(page.getByText('SEED-URREA-2')).toBeVisible()

  await page.locator('#quotation_name').fill('E2E Playwright')
  await page.locator('#customer_name').fill('ACME E2E')
  await page.getByRole('button', { name: 'Guardar cotización' }).click()

  await page.waitForURL('**/dashboard/quotations/**')
  await expect(page.getByText('E2E Playwright')).toBeVisible()
})
