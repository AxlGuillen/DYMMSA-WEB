/** R12 (plan §6, #155 C6): every tool has real phrases to evaluate it with, and the manual script names every tool. */

import { describe, test, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { dymmsaConnector } from '@/lib/mcp/connectors/dymmsa/connector'
import { odooConnector } from '@/lib/mcp/connectors/odoo/connector'

const TOOLS = [...dymmsaConnector.tools, ...odooConnector.tools]
const GUION = readFileSync(join(process.cwd(), 'DYMMSA/02-Arquitectura/MCP-Escrituras/Guion-Evaluacion.md'), 'utf8')

describe('evaluación manual (R12)', () => {
  test.each(TOOLS.map((t) => [t.name, t] as const))('%s trae de 1 a 3 frases reales para evaluarla', (_name, tool) => {
    const { evals } = tool.docs
    expect(evals.length).toBeGreaterThanOrEqual(1)
    expect(evals.length).toBeLessThanOrEqual(3)
    for (const phrase of evals) {
      expect(phrase.trim().length, phrase).toBeGreaterThan(15)
      // A phrase, not a command to the tool: it never names a tool or an argument.
      expect(phrase, phrase).not.toMatch(/\b(get|list|search|save|delete|preview|odoo)_[a-z_]+/)
    }
  })

  test('ninguna frase se repite entre tools: cada una prueba una sola elección', () => {
    const all = TOOLS.flatMap((tool) => tool.docs.evals.map((phrase) => phrase.trim().toLowerCase()))
    expect(all.filter((phrase, i) => all.indexOf(phrase) !== i)).toEqual([])
  })

  test('el guion de la bóveda nombra cada tool de los dos conectores', () => {
    const missing = TOOLS.map((t) => t.name).filter((name) => !GUION.includes(`\`${name}\``))
    expect(missing, `Tools que el guion no nombra: ${missing.join(', ')}`).toEqual([])
  })

  test('CLAUDE.md no cita como vigente una tool que ya no existe (un renombre no deja el nombre viejo en la tabla de reglas)', () => {
    const claude = readFileSync(join(process.cwd(), 'CLAUDE.md'), 'utf8')
    const names = new Set(TOOLS.map((t) => t.name))
    const RETIRED = [
      'create_task', 'update_task', 'set_inventory_location', 'mark_payable_paid', 'create_payable', 'update_payable',
      'record_payroll_hours', 'get_profiles', 'get_quotation_stats', 'get_inventory_stats', 'get_order_by_quotation',
      'odoo_employee_directory', 'odoo_fleet_status',
    ]
    // A retired name may appear as history («antes eran…», «quitó…», «de create_task»), never as the current one.
    const history = (at: number) => /antes|quitó|fusionó|renombr|retir|\bde `|\(de /.test(claude.slice(Math.max(0, at - 140), at + 60))
    const current = (name: string) => [...claude.matchAll(new RegExp('`' + name + '`', 'g'))].filter((m) => !history(m.index ?? 0))
    for (const name of RETIRED) {
      expect(names.has(name), `${name} volvió a existir: sácalo de RETIRED`).toBe(false)
      expect(current(name).length, `CLAUDE.md cita \`${name}\` como vigente`).toBe(0)
    }
  })

  test('el guion no cita tools que ya no existen (un renombre no deja nombres viejos)', () => {
    const names = new Set(TOOLS.map((t) => t.name))
    // Phase D's names are announced on purpose, in the tasks that need them.
    const PHASE_D = new Set([
      'save_quotation', 'save_order', 'save_order_reception', 'save_app_settings', 'save_purchase_decisions', 'save_cut_plan',
      'save_product', 'save_urrea_catalog_item', 'save_profile', 'save_payroll_period',
    ])
    const cited = [...GUION.matchAll(/`((?:get|list|search|save|delete|preview|odoo)_[a-z_]+)[`(]/g)].map((m) => m[1])
    const stale = [...new Set(cited)].filter((name) => !names.has(name) && !PHASE_D.has(name))
    expect(stale).toEqual([])
  })
})
