/** The consent screen's promise is generated from the manifest (#133), per role, and covers both connectors (#155 B3). */

import { describe, test, expect } from 'vitest'
import { consentSummary } from '@/lib/mcp/consent'
import { ADMIN_ONLY_TOOLS, TOOL_MANIFEST } from '@/lib/mcp/catalog'

describe('consentSummary', () => {
  test('describe siempre los dos conectores con su nombre y su ruta: la pantalla no sabe cuál se autoriza (ADR-041 §1)', () => {
    for (const role of ['admin', 'member'] as const) {
      const { app, odoo } = consentSummary(role)
      expect(app).toMatchObject({ name: 'DYMMSA-WEB', path: '/api/mcp' })
      expect(odoo).toMatchObject({ name: 'Odoo DYMMSA', path: '/api/odoo/mcp' })
    }
  })

  test('un admin ve todas las escrituras de la app con su limite; un member no ve las de administrador', () => {
    const admin = consentSummary('admin').app
    const member = consentSummary('member').app
    const writes = TOOL_MANIFEST.filter((t) => t.kind === 'write' && t.block === 'app')
    expect(admin.writes.map((w) => w.title)).toEqual(writes.map((t) => t.title))
    for (const w of admin.writes) expect(w.limits.length).toBeGreaterThan(10)
    expect(member.writes).toHaveLength(writes.filter((t) => !t.adminOnly).length)
    expect(member.writes.map((w) => w.title)).not.toContain('Cargar horas de nomina')
    expect(ADMIN_ONLY_TOOLS.has('record_payroll_hours')).toBe(true)
  })

  test('los modulos de lectura salen en el orden del manifiesto, cada uno en su conector y sin duplicados', () => {
    const { app, odoo } = consentSummary('member')
    expect(app.reads[0]).toBe('Panorama')
    expect(app.reads).toContain('Finanzas')
    expect(app.reads).not.toContain('Nomina')
    expect(app.reads).not.toContain('Contabilidad')
    expect(odoo.reads).toContain('Contabilidad')
    expect(odoo.reads).not.toContain('Finanzas')
    for (const reads of [app.reads, odoo.reads]) expect(new Set(reads).size).toBe(reads.length)
  })

  test('REGLA: cada escritura sale en su conector; las de Odoo solo para un admin (#144)', () => {
    const admin = consentSummary('admin')
    for (const w of admin.app.writes) expect(TOOL_MANIFEST.find((t) => t.title === w.title)?.block, w.title).toBe('app')
    expect(admin.odoo.writes.map((w) => w.title)).toEqual(TOOL_MANIFEST.filter((t) => t.block === 'odoo' && t.kind === 'write').map((t) => t.title))
    // The member's screen keeps promising that Odoo is never written.
    expect(consentSummary('member').odoo.writes).toEqual([])
  })
})
