/** Contract every defineTool definition keeps (#155 A3, ADR-041): checked per definition, not by hand. */

import { describe, test, expect } from 'vitest'
import { DYMMSA_TOOLS } from '@/lib/mcp/connectors/dymmsa'
import { ODOO_TOOLS } from '@/lib/mcp/connectors/odoo'
import { TOOL_BUDGET } from '@/lib/mcp/manifest'

const ALL_TOOLS = [...DYMMSA_TOOLS, ...ODOO_TOOLS]

describe.each(ALL_TOOLS.map((t) => [t.name, t] as const))('definición %s', (name, tool) => {
  test('nombre snake_case de hasta 64 caracteres, con el prefijo de su conector', () => {
    expect(name).toMatch(/^[a-z][a-z0-9_]{0,63}$/)
    expect(name.startsWith('odoo_')).toBe(tool.connector === 'odoo')
  })

  test('descripción con contenido y dentro de su tope', () => {
    const cap = TOOL_BUDGET.descriptionExceptions[name] ?? TOOL_BUDGET.description
    expect(tool.description.length).toBeGreaterThan(40)
    expect(tool.description.length).toBeLessThanOrEqual(cap)
  })

  test('las anotaciones dicen lo mismo que el tipo de tool, y una escritura declara sus límites', () => {
    expect(tool.annotations.readOnlyHint === true).toBe(tool.kind === 'read')
    if (tool.kind === 'write') expect(tool.docs.limits?.length).toBeGreaterThan(0)
    expect(tool.docs.example.length).toBeGreaterThan(0)
    // Odoo is a third-party system others edit (ADR-041 §10); DYMMSA-WEB's domain is closed.
    expect(tool.annotations.openWorldHint).toBe(tool.connector === 'odoo')
  })

  test('ANOTACIONES (ADR-041 §10): una escritura de Odoo declara destructiveHint e idempotentHint', () => {
    if (tool.connector !== 'odoo' || tool.kind !== 'write') return
    expect(typeof tool.annotations.destructiveHint).toBe('boolean')
    expect(typeof tool.annotations.idempotentHint).toBe('boolean')
  })

  test('REGLA (ADR-040): toda escritura de Odoo es de administrador', () => {
    if (tool.connector === 'odoo' && tool.kind === 'write') expect(tool.adminOnly).toBe(true)
  })
})

test('ningún nombre se repite entre definiciones', () => {
  const names = ALL_TOOLS.map((t) => t.name)
  expect(new Set(names).size).toBe(names.length)
})

test('cada definición está en la lista del conector que declara (#155 B3: cada conector sirve solo la suya)', () => {
  expect(DYMMSA_TOOLS.filter((t) => t.connector !== 'dymmsa').map((t) => t.name)).toEqual([])
  expect(ODOO_TOOLS.filter((t) => t.connector !== 'odoo').map((t) => t.name)).toEqual([])
})
