/** The consent screen's promise is generated from the manifest (#133), per role, so it can no longer go stale. */

import { describe, test, expect } from 'vitest'
import { consentSummary } from '@/lib/mcp/consent'
import { ADMIN_ONLY_TOOLS, TOOL_MANIFEST } from '@/lib/mcp/manifest'

describe('consentSummary', () => {
  test('un admin ve todas las escrituras con su limite; un member no ve las de administrador', () => {
    const admin = consentSummary('admin')
    const member = consentSummary('member')
    const writes = TOOL_MANIFEST.filter((t) => t.kind === 'write')
    expect(admin.writes.map((w) => w.title)).toEqual(writes.map((t) => t.title))
    for (const w of admin.writes) expect(w.limits.length).toBeGreaterThan(10)
    expect(member.writes).toHaveLength(writes.filter((t) => !t.adminOnly).length)
    expect(member.writes.map((w) => w.title)).not.toContain('Cargar horas de nomina')
    expect(ADMIN_ONLY_TOOLS.has('record_payroll_hours')).toBe(true)
  })

  test('los modulos de lectura salen en el orden del manifiesto, sin Odoo ni duplicados', () => {
    const { reads } = consentSummary('member')
    expect(reads[0]).toBe('Panorama')
    expect(reads).toContain('Finanzas')
    expect(reads).not.toContain('Nomina')
    expect(reads).not.toContain('Contabilidad')
    expect(new Set(reads).size).toBe(reads.length)
  })

  test('REGLA: solo escrituras del bloque app, nunca de Odoo (la pantalla promete que no escribe ahi)', () => {
    for (const w of consentSummary('admin').writes) {
      const entry = TOOL_MANIFEST.find((t) => t.title === w.title)
      expect(entry?.block, w.title).toBe('app')
    }
  })
})
