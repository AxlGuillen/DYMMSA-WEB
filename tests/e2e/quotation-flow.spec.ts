/**
 * E2E de navegador (Fase C2) — el flujo visual que solo el browser prueba:
 * login real (Supabase auth) → subir Excel → cotizador poblado → guardar →
 * detalle persistido. La profundidad transaccional (orden/recepción) ya la
 * cubre C1; aquí validamos auth + upload de archivo + estado del cliente + save.
 *
 * Requiere `bunx supabase start`. Correr con: bun run test:e2e
 */
import { test, expect } from '@playwright/test'
import * as XLSX from 'xlsx'

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

/** Genera un .xlsx real en memoria con ETMs que existen en los fixtures locales. */
function excelBuffer(rows: Record<string, unknown>[]): Buffer {
  const ws = XLSX.utils.json_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Cotizacion')
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}

test('login → subir Excel → cotizador poblado → guardar cotización', async ({ page }) => {
  // ── 1. Login real contra el auth local ──────────────────────────────────
  await page.goto('/login')
  await page.locator('#email').fill('test@dymmsa.local')
  await page.locator('#password').fill('testpassword123')
  await page.getByRole('button', { name: 'Iniciar sesión' }).click()
  await page.waitForURL('**/dashboard**')

  // ── 2. Cotizador: subir un Excel con ETMs de los fixtures ───────────────
  await page.goto('/dashboard/quoter')
  const buffer = excelBuffer([
    { ETM: 'SEED-URREA-1', codigo_modelo: '60001', marca: 'URREA', cantidad: 2, precio: 100 },
    { ETM: 'SEED-URREA-2', codigo_modelo: '60002', marca: 'URREA', cantidad: 3, precio: 50 },
  ])
  await page
    .locator('input[aria-label="Seleccionar archivo Excel"]')
    .setInputFiles({ name: 'e2e.xlsx', mimeType: XLSX_MIME, buffer })
  // El uploader es de dos pasos: seleccionar → procesar (parse + lookup).
  await page.getByRole('button', { name: 'Procesar archivo' }).click()

  // ── 3. El editor se pobló con los productos del Excel ───────────────────
  await expect(page.getByText('SEED-URREA-1')).toBeVisible()
  await expect(page.getByText('SEED-URREA-2')).toBeVisible()

  // ── 4. Encabezado + guardar ─────────────────────────────────────────────
  await page.locator('#quotation_name').fill('E2E Playwright')
  await page.locator('#customer_name').fill('ACME E2E')
  await page.getByRole('button', { name: 'Guardar cotización' }).click()

  // ── 5. Persistió: redirige al detalle con el nombre de la cotización ────
  await page.waitForURL('**/dashboard/quotations/**')
  await expect(page.getByText('E2E Playwright')).toBeVisible()
})
