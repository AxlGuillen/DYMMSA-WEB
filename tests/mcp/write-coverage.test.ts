/**
 * Write net (#155 C5): every POST/PATCH/PUT/DELETE handler of the app is either written by an MCP tool or left out on
 * purpose, with the reason. A new write route without a decision fails here instead of being forgotten; the reads over
 * POST, the cache refreshes and the public route are classified apart. Phase D turns its "Fase D" entries into tools.
 */

import { describe, test, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { TOOL_MANIFEST } from '@/lib/mcp/catalog'

const API_ROOT = join(process.cwd(), 'src/app/api')
const WRITE_METHODS = ['POST', 'PATCH', 'PUT', 'DELETE'] as const
type WriteMethod = (typeof WRITE_METHODS)[number]

/** "METHOD route" of every write handler: `export function X`, `export const X` or `handler as X`. */
function writeHandlers(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) writeHandlers(full, out)
    else if (entry === 'route.ts') {
      const text = readFileSync(full, 'utf8')
      // Forward slashes on every OS: the map is POSIX-style and Windows would give backslashes.
      const route = relative(API_ROOT, dir).split(sep).join('/')
      for (const method of WRITE_METHODS) {
        const exported = new RegExp(`export\\s+(async\\s+)?function\\s+${method}\\b|export\\s+const\\s+${method}\\b|\\bas\\s+${method}\\b`)
        if (exported.test(text)) out.push(`${method} ${route}`)
      }
    }
  }
  return out.sort()
}

/**
 * - `tool`: the write tool(s) that cover it.
 * - `lectura`: a POST that only reads; the read tool that answers the same, or why none.
 * - `cache`: purges a cache, writes no data.
 * - `publica`: the public route, answered by the customer and never by the assistant.
 * - `fuera`: left to the app on purpose, or pending (`Fase D`: the next PR turns it into a tool).
 */
type Decision =
  | { tool: string | readonly string[] }
  | { lectura: string | null; motivo: string }
  | { cache: string }
  | { publica: string }
  | { fuera: string }

// delete_record arrives in commit 5 of this PR; its routes then switch to { tool: 'delete_record' }.
const DELETE_PENDING = 'delete_record llega en el commit 5 de este PR (#155 C)'
const PHASE_D = 'Fase D: '

const COVERAGE: Record<string, Decision> = {
  // MCP endpoints
  'POST [transport]': { fuera: 'es el propio endpoint MCP de DYMMSA-WEB' },
  'DELETE [transport]': { fuera: 'es el propio endpoint MCP de DYMMSA-WEB (cierra la sesión)' },
  'POST odoo/[transport]': { fuera: 'es el endpoint MCP del conector Odoo DYMMSA' },
  'DELETE odoo/[transport]': { fuera: 'es el endpoint MCP del conector Odoo DYMMSA (cierra la sesión)' },

  // The public approval page
  'POST approve/[token]': { publica: 'la responde el cliente desde su link, nunca el asistente' },

  // Reads that travel over POST
  'POST quotes/lookup': { lectura: 'search_products', motivo: 'busca ETM y códigos para las filas del cotizador; solo lee' },
  'POST urrea-catalog/lookup': { lectura: 'search_urrea_catalog', motivo: 'resuelve códigos contra el catálogo oficial; solo lee' },

  // Cache refreshes
  'POST finance/income/refresh': { cache: 'purga la caché de ingresos de Odoo (get_month_closing la lee con la caché vigente)' },
  'POST clients/refresh': { cache: 'purga la caché de cartera de Odoo; las tools de Odoo leen directo' },

  // Ajustes
  'PATCH settings': { fuera: `${PHASE_D}save_app_settings (umbrales del planificador y margen de corte)` },

  // Cotizaciones
  'POST quotations/save': { fuera: `${PHASE_D}save_quotation (crear)` },
  'PATCH quotations/[id]/update': { fuera: `${PHASE_D}save_quotation (editar por línea)` },
  'PATCH quotations/[id]/status': { fuera: `${PHASE_D}save_quotation (estado; regenera el link de aprobación)` },
  'POST quotations/[id]/send-for-approval': { fuera: `${PHASE_D}save_quotation (estado en_revision)` },
  'POST quotations/[id]/create-order': { fuera: `${PHASE_D}save_order (crear desde cotización)` },
  'DELETE quotations/[id]': { fuera: 'borrar cotizaciones queda en la app (decisión 4 de ADR-041)' },

  // Órdenes
  'POST orders/create': { fuera: `${PHASE_D}save_order (orden manual)` },
  'PATCH orders/[id]': { fuera: `${PHASE_D}save_order (encabezado de la orden)` },
  'PATCH orders/[id]/status': { fuera: `${PHASE_D}save_order (estado)` },
  'POST orders/[id]/cancel': { fuera: `${PHASE_D}save_order (estado cancelada, restaura stock)` },
  'DELETE orders/[id]': { fuera: 'borrar órdenes queda en la app (decisión 4 de ADR-041)' },
  'POST orders/[id]/items': { fuera: `${PHASE_D}save_order (cambios: agregar línea)` },
  'PATCH orders/[id]/items/[itemId]': { fuera: `${PHASE_D}save_order (cambios por línea)` },
  'DELETE orders/[id]/items/[itemId]': { fuera: `${PHASE_D}save_order (cambios: quitar línea)` },
  'POST orders/[id]/confirm-reception': { fuera: `${PHASE_D}save_order_reception` },
  'POST orders/auto-learn': { fuera: 'aprendizaje interno que la app dispara al guardar; no es una acción del usuario' },

  // Compra y corte
  'PUT orders/[id]/purchase-decisions': { fuera: `${PHASE_D}save_purchase_decisions` },
  'PUT orders/[id]/cut-plan': { fuera: `${PHASE_D}save_cut_plan` },
  'POST material-presentations': { tool: 'save_material_presentation' },
  'DELETE material-presentations/[id]': { fuera: DELETE_PENDING },

  // Inventario
  'POST inventory': { fuera: `${PHASE_D}save_inventory_item (alta con cantidad)` },
  'PATCH inventory/[id]': { fuera: `${PHASE_D}save_inventory_item (cantidades; la gaveta ya la escribe set_inventory_location)` },
  'DELETE inventory/[id]': { fuera: 'borrar inventario queda en la app (decisión 4 de ADR-041)' },
  'POST inventory/import': { fuera: 'carga masiva por Excel: se hace en la app' },

  // Catálogos
  'POST products': { fuera: `${PHASE_D}save_product` },
  'PATCH products/[id]': { fuera: `${PHASE_D}save_product` },
  'DELETE products/[id]': { fuera: 'borrar productos queda en la app (decisión 4 de ADR-041)' },
  'POST products/import': { fuera: 'carga masiva por Excel: se hace en la app' },
  'POST urrea-catalog': { fuera: `${PHASE_D}save_urrea_catalog_item` },
  'PATCH urrea-catalog/[id]': { fuera: `${PHASE_D}save_urrea_catalog_item` },
  'DELETE urrea-catalog/[id]': { fuera: 'borrar del catálogo queda en la app (decisión 4 de ADR-041)' },
  'POST urrea-catalog/import': { fuera: 'carga masiva por Excel: se hace en la app' },

  // Proveedores y marcas
  'POST suppliers': { tool: 'save_supplier' },
  'PATCH suppliers/[id]': { tool: 'save_supplier' },
  'DELETE suppliers/[id]': { fuera: DELETE_PENDING },
  'POST brands': { fuera: 'pendiente de decidir: save_supplier.crear_marcas (ADR-041 §13) no está en el plan de las fases C ni D' },
  'PATCH brands/[id]': { fuera: 'renombrar marcas queda en la app (Auditoría DYMMSA-WEB, resolución 6)' },
  'DELETE brands/[id]': { fuera: DELETE_PENDING },

  // Finanzas
  'POST payables': { tool: 'create_payable' },
  'PATCH payables/[id]': { tool: ['update_payable', 'mark_payable_paid'] },
  'DELETE payables/[id]': { fuera: DELETE_PENDING },

  // Horas
  'POST time-entries/import': { tool: 'save_time_entries' },
  'POST time-entries': { tool: 'save_time_entries' },
  'PATCH time-entries/[id]': { tool: 'save_time_entries' },
  'DELETE time-entries/[id]': { fuera: DELETE_PENDING },
  'POST excused-days': { tool: 'save_excused_day' },
  'DELETE excused-days/[id]': { fuera: DELETE_PENDING },

  // Equipo y perfil
  'PATCH profile': { fuera: `${PHASE_D}save_profile (lo propio)` },
  'PATCH profiles/[id]': { fuera: `${PHASE_D}save_profile (otra persona; sin rol ni tarifa)` },
  'POST profile/avatar': { fuera: 'la foto es un archivo binario: se sube desde Mi perfil' },
  'DELETE profile/avatar': { fuera: 'la foto es un archivo binario: se quita desde Mi perfil' },

  // Nómina
  'PUT payroll/days': { tool: 'record_payroll_hours' },
  'POST payroll/periods/[start]/prefill': { tool: 'record_payroll_hours' },
  'POST payroll/periods/[start]/confirm': { fuera: `${PHASE_D}save_payroll_period (confirmar_borradores)` },
  'PATCH payroll/periods/[start]': { fuera: `${PHASE_D}save_payroll_period (cerrar y reabrir)` },
  'POST payroll/employees': { tool: 'save_payroll_employee' },
  'PATCH payroll/employees/[id]': { tool: 'save_payroll_employee' },

  // Tareas
  'POST tasks': { tool: 'create_task' },
  'PATCH tasks/[number]': { tool: 'update_task' },
  'POST tasks/[number]/comments': { tool: 'update_task' },
  'POST tasks/upload': { fuera: 'las imágenes de una tarea se adjuntan desde la app' },
}

const kindOf = new Map(TOOL_MANIFEST.map((t) => [t.name, t.kind]))
const toolsOf = (d: Decision) => ('tool' in d ? ([] as string[]).concat(d.tool) : 'lectura' in d && d.lectura ? [d.lectura] : [])
const reasonOf = (d: Decision) => ('tool' in d ? 'tool' : 'lectura' in d ? d.motivo : 'cache' in d ? d.cache : 'publica' in d ? d.publica : d.fuera)

describe('cobertura del MCP sobre las rutas de escritura', () => {
  const handlers = writeHandlers(API_ROOT)

  test('el escaneo ve los handlers de escritura de las cuatro formas de exportar', () => {
    expect(handlers.length).toBeGreaterThan(60)
    expect(handlers).toContain('PATCH quotations/[id]/status')
    expect(handlers).toContain('PUT orders/[id]/cut-plan')
    expect(handlers).toContain('DELETE [transport]')
    expect(new Set(handlers.map((h) => h.split(' ')[0]))).toEqual(new Set<WriteMethod>(WRITE_METHODS))
  })

  test('todo handler de escritura está cubierto por una tool o dejado fuera con su motivo', () => {
    const missing = handlers.filter((h) => !(h in COVERAGE))
    expect(missing, `Handlers de escritura sin decisión en COVERAGE: ${missing.join(', ')}`).toEqual([])
  })

  test('el mapa no arrastra handlers que ya no existen', () => {
    const stale = Object.keys(COVERAGE).filter((h) => !handlers.includes(h))
    expect(stale, `Entradas de COVERAGE sin handler: ${stale.join(', ')}`).toEqual([])
  })

  test('una tool que cubre existe y escribe; una lectura por POST nombra una tool de lectura', () => {
    const wrong: string[] = []
    for (const [handler, decision] of Object.entries(COVERAGE)) {
      for (const name of toolsOf(decision)) {
        const expected = 'tool' in decision ? 'write' : 'read'
        if (kindOf.get(name) !== expected) wrong.push(`${handler} → ${name} (${kindOf.get(name) ?? 'no existe'}, debía ser ${expected})`)
      }
    }
    expect(wrong, wrong.join('; ')).toEqual([])
  })

  test('todo «fuera» y toda clasificación aparte trae un motivo escrito', () => {
    const thin = Object.entries(COVERAGE)
      .filter(([, d]) => !('tool' in d))
      .filter(([, d]) => reasonOf(d).trim().length < 15)
    expect(thin.map(([h]) => h)).toEqual([])
  })
})
