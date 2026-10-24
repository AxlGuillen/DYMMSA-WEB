/** Contract every defineTool definition keeps (#155 A3, ADR-041): checked per definition, not by hand. */

import { describe, test, expect } from 'vitest'
import { z } from 'zod'
import { DYMMSA_TOOLS } from '@/lib/mcp/connectors/dymmsa'
import { ODOO_TOOLS } from '@/lib/mcp/connectors/odoo'
import { parseInput, strictInput } from '@/lib/mcp/core/schema'
import { TOOL_BUDGET } from '@/lib/mcp/manifest'

const ALL_TOOLS = [...DYMMSA_TOOLS, ...ODOO_TOOLS]

type JsonSchema = { type?: string; properties?: Record<string, JsonSchema>; items?: JsonSchema | JsonSchema[]; additionalProperties?: unknown; format?: string; pattern?: string; anyOf?: JsonSchema[] }

/** Every object node of the schema, nested ones included, with its path. */
function objectNodes(node: JsonSchema, path = 'entrada'): [string, JsonSchema][] {
  const own: [string, JsonSchema][] = node.type === 'object' ? [[path, node]] : []
  const props = Object.entries(node.properties ?? {}).flatMap(([key, child]) => objectNodes(child, `${path}.${key}`))
  const items = (Array.isArray(node.items) ? node.items : node.items ? [node.items] : []).flatMap((child) => objectNodes(child, `${path}[]`))
  const options = (node.anyOf ?? []).flatMap((child) => objectNodes(child, path))
  return [...own, ...props, ...items, ...options]
}

// Same conversion the SDK runs for tools/list (zod's own, io input, draft-07).
const jsonSchemaOf = (name: string, input: z.ZodRawShape) =>
  z.toJSONSchema(strictInput(name, input), { io: 'input', target: 'draft-07' }) as JsonSchema

const DATE_KEY = /^(fecha|fecha_\w+|vencimiento|vence_desde|vence_hasta|desde|hasta|vigencia)$/

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

  test('ENTRADA ESTRICTA (#155 C1): cada objeto del JSON Schema lleva additionalProperties: false', () => {
    const nodes = objectNodes(jsonSchemaOf(name, tool.input))
    expect(nodes.length).toBeGreaterThan(0)
    expect(nodes.filter(([, node]) => node.additionalProperties !== false).map(([path]) => path)).toEqual([])
  })

  test('una fecha nunca es texto libre: format date, y un mes con su patrón', () => {
    const loose = objectNodes(jsonSchemaOf(name, tool.input)).flatMap(([path, node]) =>
      Object.entries(node.properties ?? {})
        .filter(([key, prop]) => (DATE_KEY.test(key) && prop.format !== 'date') || (key === 'mes' && !prop.pattern))
        .map(([key]) => `${path}.${key}`),
    )
    expect(loose).toEqual([])
  })

  test('el error por un campo desconocido trae un ejemplo que la propia tool acepta', () => {
    let message = ''
    try {
      parseInput(name, tool.input, { campo_que_no_existe: 1 })
    } catch (error) {
      message = (error as Error).message
    }
    expect(message.startsWith(`Entrada inválida en ${name}: `)).toBe(true)
    expect(message).toMatch(/el campo «campo_que_no_existe» no existe[.;].*(Campos válidos: |No lleva campos\.)/)
    const example = message.match(/ Ej\.: (.*)$/)?.[1]
    expect(example, message).toBeDefined()
    expect(() => parseInput(name, tool.input, JSON.parse(example as string))).not.toThrow()
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
