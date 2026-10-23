/** Contract every defineTool definition keeps (#155 A3, ADR-041): checked per definition, not by hand. */

import { describe, test, expect } from 'vitest'
import { ODOO_TOOLS } from '@/lib/mcp/connectors/odoo'
import { TOOL_BUDGET } from '@/lib/mcp/manifest'

describe.each(ODOO_TOOLS.map((t) => [t.name, t] as const))('definición %s', (name, tool) => {
  test('nombre snake_case de hasta 64 caracteres, con el prefijo de su conector', () => {
    expect(name).toMatch(/^[a-z][a-z0-9_]{0,63}$/)
    if (tool.connector === 'odoo') expect(name.startsWith('odoo_')).toBe(true)
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
    expect(tool.annotations.openWorldHint).toBe(false)
  })

  test('REGLA (ADR-040): toda escritura de Odoo es de administrador', () => {
    if (tool.connector === 'odoo' && tool.kind === 'write') expect(tool.adminOnly).toBe(true)
  })
})

test('ningún nombre se repite entre definiciones', () => {
  const names = ODOO_TOOLS.map((t) => t.name)
  expect(new Set(names).size).toBe(names.length)
})
