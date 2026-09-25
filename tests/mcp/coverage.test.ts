/**
 * Anti-drift (#109): every GET route of the app is either read by an MCP tool or excluded on
 * purpose. A new module without a tool fails here instead of being forgotten.
 */

import { describe, test, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const API_ROOT = join(process.cwd(), 'src/app/api')

/** Route dirs (relative to src/app/api) whose route.ts exports a GET handler. */
function getRoutes(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) getRoutes(full, out)
    else if (entry === 'route.ts' && /export\s+(async\s+)?function\s+GET\b|export\s+const\s+GET\b|\bas\s+GET\b/.test(readFileSync(full, 'utf8'))) {
      // Forward slashes on every OS: the map is POSIX-style and Windows would give backslashes.
      out.push(relative(API_ROOT, dir).split(sep).join('/'))
    }
  }
  return out.sort()
}

/** Tool that covers the route, or "fuera: <why>" when the assistant must not need it. */
const COVERAGE: Record<string, string> = {
  '[transport]': 'fuera: es el propio endpoint MCP',
  'approve/[token]': 'fuera: página pública sin sesión',
  brands: 'list_suppliers (marcas por proveedor)',
  'finance/income': 'get_month_closing',
  health: 'fuera: diagnóstico del servidor',
  inventory: 'search_inventory',
  'inventory/stats': 'get_inventory_stats',
  'material-presentations': 'get_cut_plan (presentaciones por grupo)',
  'orders/[id]/cut-plan': 'get_cut_plan',
  'orders/[id]/purchase-plan': 'get_purchase_plan',
  'orders/by-quotation/[quotationId]': 'get_order_by_quotation',
  payables: 'list_payables',
  'payables/[id]/events': 'get_payable (historial)',
  'payables/overview': 'get_payables_overview',
  products: 'search_products',
  'products/next-dymmsa-code': 'fuera: consecutivo interno del alta de productos',
  profile: 'fuera: sesión propia (el MCP ya trae al usuario en el token)',
  profiles: 'get_week_hours / get_hours_trend (persona por nombre)',
  quotations: 'list_quotations',
  'quotations/[id]': 'get_quotation',
  'quotations/[id]/cut-candidates': 'fuera: siembra de UI para el corte rápido',
  'quotations/stats': 'get_quotation_stats',
  settings: 'get_app_settings',
  suppliers: 'list_suppliers',
  tasks: 'list_tasks',
  'tasks/[number]': 'get_task',
  'time-entries': 'get_week_hours',
  'time-entries/imports': 'list_time_imports',
  'urrea-catalog': 'search_urrea_catalog',
  'urrea-catalog/stats': 'get_business_summary (tamaño de catálogos)',
}

describe('cobertura del MCP sobre las rutas GET', () => {
  const routes = getRoutes(API_ROOT)

  test('toda ruta GET está cubierta por una tool o excluida a propósito', () => {
    const missing = routes.filter((r) => !(r in COVERAGE))
    expect(missing, `Rutas GET sin decisión en COVERAGE: ${missing.join(', ')}`).toEqual([])
  })

  test('el mapa no arrastra rutas que ya no existen', () => {
    const stale = Object.keys(COVERAGE).filter((r) => !routes.includes(r))
    expect(stale, `Entradas de COVERAGE sin ruta: ${stale.join(', ')}`).toEqual([])
  })
})
