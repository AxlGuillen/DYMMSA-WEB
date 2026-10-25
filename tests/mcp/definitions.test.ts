/** Contract every defineTool definition keeps (#155 A3, ADR-041): checked per definition, not by hand. */

import { describe, test, expect, vi } from 'vitest'

// run() builds the caller's Db from the token; the output contract below never reaches it.
vi.mock('@/lib/mcp/core/auth/supabase', () => ({ clientForToken: vi.fn(() => ({})), verifierClient: vi.fn() }))

import { z } from 'zod'
import { DYMMSA_TOOLS } from '@/lib/mcp/connectors/dymmsa'
import { ODOO_TOOLS } from '@/lib/mcp/connectors/odoo'
import { dymmsaConnector } from '@/lib/mcp/connectors/dymmsa/connector'
import { odooConnector } from '@/lib/mcp/connectors/odoo/connector'
import { toolAnnotations, type ToolDefinition } from '@/lib/mcp/core/define'
import { parseInput, strictInput } from '@/lib/mcp/core/schema'
import { TOOL_BUDGET } from '@/lib/mcp/manifest'
import { authAs, connectMcp, textOf } from './harness'

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

  test('ANOTACIONES (R8, #155 C2): las cuatro, explícitas; readOnlyHint sale del tipo y una escritura declara sus límites', () => {
    const annotations = toolAnnotations(tool)
    expect(Object.keys(annotations)).toEqual(['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint'])
    expect(Object.values(annotations).every((value) => typeof value === 'boolean')).toBe(true)
    expect(annotations.readOnlyHint).toBe(tool.kind === 'read')
    if (tool.kind === 'read') expect(annotations).toMatchObject({ destructiveHint: false, idempotentHint: true })
    // Odoo is a third-party system others edit (ADR-041 §10); DYMMSA-WEB's domain is closed (Auditoría DYMMSA-WEB §3).
    expect(annotations.openWorldHint).toBe(tool.connector === 'odoo')
    if (tool.kind === 'write') expect(tool.docs.limits?.length).toBeGreaterThan(0)
    expect(tool.docs.example.length).toBeGreaterThan(0)
  })

  test('la definición no escribe anotaciones crudas ni readOnlyHint: solo los hints de su tipo (#155 C2)', () => {
    expect(tool).not.toHaveProperty('annotations')
    const expected = tool.kind === 'read' ? ['openWorldHint'] : ['destructiveHint', 'idempotentHint', 'openWorldHint']
    expect(Object.keys(tool.hints).sort()).toEqual(expected)
  })

  test('SALIDA (#155 C3, §3.5): output solo donde un consumidor lo lee, la tool que abre una vista', () => {
    expect(Boolean(tool.output), 'una vista lee el structuredContent: declara su output; sin vista, el outputSchema solo gasta presupuesto').toBe(Boolean(tool.view))
  })

  test('REGLA (ADR-041 §5): una tool de dos fases no declara output ni view (la fase 1 y la 2 responden formas distintas)', () => {
    if (tool.confirm === 'two_phase') {
      expect(tool.output).toBeUndefined()
      expect(tool.view).toBeUndefined()
    }
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

/**
 * E(d,i) of every write, as the audits decided (Auditoría DYMMSA-WEB H7 and §4.8; ADR-041 §10, #155 C2).
 * d = destructiveHint, i = idempotentHint; changing one is a decision its PR explains.
 */
const WRITE_HINTS: Record<string, string> = {
  delete_record: 'E(1,1)',
  save_app_settings: 'E(1,1)',
  save_product: 'E(1,0)',
  save_urrea_catalog_item: 'E(1,1)',
  save_profile: 'E(1,1)',
  save_payroll_period: 'E(1,1)',
  save_quotation: 'E(1,0)',
  save_purchase_decisions: 'E(1,1)',
  save_cut_plan: 'E(1,0)',
  save_material_presentation: 'E(0,1)',
  // Phase D adds quantities (a delta adjustment) and flips this to E(1,0).
  save_inventory_item: 'E(1,0)',
  save_supplier: 'E(1,1)',
  // The merged tools (#155 C6): the weakest hint of what they replaced, as the audit decided (§3).
  save_payable: 'E(1,0)',
  save_time_entries: 'E(1,1)',
  save_excused_day: 'E(1,1)',
  save_payroll_hours: 'E(1,1)',
  save_payroll_employee: 'E(1,1)',
  save_task: 'E(1,0)',
  odoo_save_quotation: 'E(1,1)',
  odoo_confirm_quotation: 'E(1,1)',
  odoo_save_product: 'E(0,1)',
  odoo_create_draft_invoice: 'E(0,1)',
}

test('ANOTACIONES (#155 C2): cada escritura de los dos conectores declara lo que decidió su auditoría', () => {
  const declared = Object.fromEntries(
    ALL_TOOLS.flatMap((tool) => {
      if (tool.kind !== 'write') return []
      const { destructiveHint, idempotentHint } = toolAnnotations(tool)
      return [[tool.name, `E(${Number(destructiveHint)},${Number(idempotentHint)})`]]
    }),
  )
  expect(declared).toEqual(WRITE_HINTS)
})

/** A minimal valid answer per tool with output: a new output without its sample fails below. */
const OUTPUT_SAMPLES: Record<string, Record<string, unknown>> = {
  preview_time_report: {
    periodo: { inicio: '2026-08-31', fin: '2026-09-06' },
    nombre_archivo: null,
    cuadra: true,
    problemas: [],
    dias: [{ fecha: '2026-08-31', dia: 'Lun' }],
    personas: [
      {
        nombre: 'Tania',
        id_checador: 5,
        perfil: 'Tania',
        por_dia: [{ fecha: '2026-08-31', horas: '08:00', checadas: ['09:00–17:00'], sin_salida: false }],
        total: '08:00',
        total_reporte: '08:00',
        cuadra: true,
      },
    ],
    sin_perfil: [],
    no_vinieron_en_el_reporte: [],
    avisos: [],
    clave: null,
    vence: null,
    siguiente_paso: 'Nada se ha guardado.',
  },
  odoo_preview_quotation: {
    modo: 'revisar',
    puede_guardar: false,
    bloqueos: ['La S00912 no tiene productos: no se puede confirmar.'],
    avisos: [],
    clave: null,
    vence: null,
    siguiente_paso: 'Nada se ha guardado.',
    lineas: [],
    productos_nuevos: [],
    productos_para_alta: [],
    sin_clave_sat: [],
    // Loose: what the schema doesn't describe also travels.
    cliente: { id: 1, nombre: 'GE POWER SERVICES MEXICO' },
  },
}

const OUTPUT_TOOLS = ALL_TOOLS.filter((t) => t.output)

/** The example of the tool's own input error, which the contract above proves it accepts. */
function validInput(tool: ToolDefinition): Record<string, unknown> {
  try {
    parseInput(tool.name, tool.input, { campo_que_no_existe: 1 })
  } catch (error) {
    return JSON.parse((error as Error).message.match(/ Ej\.: (.*)$/)?.[1] ?? '{}') as Record<string, unknown>
  }
  return {}
}

test('SALIDA (#155 C3): las tools con output son las dos vistas, y cada una tiene su muestra', () => {
  expect(OUTPUT_TOOLS.map((t) => t.name).sort()).toEqual(['odoo_preview_quotation', 'preview_time_report'])
  expect(Object.keys(OUTPUT_SAMPLES).sort()).toEqual(OUTPUT_TOOLS.map((t) => t.name).sort())
})

describe.each(OUTPUT_TOOLS.map((t) => [t.name, t] as const))('output de %s (#155 C3)', (name, tool) => {
  const output = tool.output as z.ZodObject

  test('ningún objeto es un z.object normal: su JSON Schema dice lo mismo de entrada y de salida', () => {
    // A strip object passes the server's zod but its additionalProperties: false makes the client reject the result.
    expect(z.toJSONSchema(output, { io: 'input', target: 'draft-07' })).toEqual(z.toJSONSchema(output, { io: 'output', target: 'draft-07' }))
  })

  test('el registro anuncia el outputSchema y la llamada trae structuredContent que lo cumple, igual al texto', async () => {
    const connector = tool.connector === 'odoo' ? odooConnector : dymmsaConnector
    const stub: ToolDefinition = { ...tool, handler: async () => OUTPUT_SAMPLES[name] }
    const mcp = await connectMcp('admin', authAs('admin'), { ...connector, tools: [stub] })
    try {
      // Listed first: the client checks the result against the schema it got.
      const [listed] = await mcp.tools()
      expect(listed.outputSchema).toEqual(z.toJSONSchema(output, { io: 'output', target: 'draft-07' }))
      const result = await mcp.call(name, validInput(tool))
      expect(result.isError, textOf(result)).toBeFalsy()
      expect(result.structuredContent).toEqual(OUTPUT_SAMPLES[name])
      expect(JSON.parse(textOf(result))).toEqual(result.structuredContent)
    } finally {
      await mcp.close()
    }
  })

  test('una respuesta que no lo cumple es error, no un structuredContent falso', async () => {
    const connector = tool.connector === 'odoo' ? odooConnector : dymmsaConnector
    const [firstKey] = Object.keys(output.shape)
    const broken = Object.fromEntries(Object.entries(OUTPUT_SAMPLES[name]).filter(([key]) => key !== firstKey))
    const stub: ToolDefinition = { ...tool, handler: async () => broken }
    const mcp = await connectMcp('admin', authAs('admin'), { ...connector, tools: [stub] })
    try {
      const result = await mcp.call(name, validInput(tool))
      expect(result.isError).toBe(true)
      expect(textOf(result)).toMatch(new RegExp(`Output validation error: Invalid structured content for tool ${name}`))
    } finally {
      await mcp.close()
    }
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
