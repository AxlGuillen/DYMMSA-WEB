/** Confirmation in two phases (#155 C4, ADR-041 §5): the core decides the phase, with the real SDK client and server. */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { z } from 'zod'

vi.mock('@/lib/mcp/core/auth/supabase', () => ({
  clientForToken: vi.fn(() => ({ from: vi.fn() })),
  verifierClient: vi.fn(),
}))

import { defineTool, type ToolDefinition, type WritePlan } from '@/lib/mcp/core/define'
import { dymmsaConnector } from '@/lib/mcp/connectors/dymmsa/connector'
import { getAppSettingsTool } from '@/lib/mcp/connectors/dymmsa/settings/get-app-settings'
import { authAs, connectMcp, textOf } from './harness'
import { TEST_PREVIEW_SECRET } from '../helpers/preview-secret'
import { PHASE_ONE_NOTE } from '@/lib/mcp/core/confirm/two-phase'

/** What the fake store holds: the fingerprint of the write, and what each commit did. */
const world = { version: 1, plans: 0, commits: [] as string[], blocked: [] as string[], nothingToDo: false }

function twoPhaseTool(name: string) {
  return defineTool({
    connector: 'dymmsa',
    name,
    kind: 'write',
    title: 'Prueba en dos fases',
    description: 'Herramienta de prueba del núcleo: planea y confirma una escritura en dos fases.',
    input: { nombre: z.string(), cantidad: z.number().optional() },
    hints: { destructiveHint: true, idempotentHint: false, openWorldHint: false },
    adminOnly: true,
    confirm: 'two_phase',
    docs: { module: 'Prueba', title: 'Prueba', example: 'Haz la prueba.', limits: 'Solo prueba.' },
    plan: async (input): Promise<WritePlan<{ leidoEn: number }>> => {
      world.plans += 1
      return {
        entity: { key: 'prueba', value: { nombre: input.nombre } },
        cambios: { cantidad: { antes: 1, ahora: input.cantidad ?? 1 } },
        avisos: ['Un aviso'],
        bloqueos: world.blocked,
        sinCambios: world.nothingToDo,
        fingerprint: { version: world.version },
        subject: `La prueba ${input.nombre}`,
        carry: { leidoEn: world.version },
      }
    },
    commit: async (input, ctx, plan) => {
      world.commits.push(`${ctx.userId}:${input.nombre}:v${plan.carry.leidoEn}`)
      return { accion: 'creado', escrito: true, prueba: { nombre: input.nombre } }
    },
  })
}

async function connect(tools: ToolDefinition[], user = 'admin-1') {
  return connectMcp('admin', authAs('admin', user), { ...dymmsaConnector, tools })
}

const parse = (text: string) => JSON.parse(text) as Record<string, unknown>

beforeEach(() => {
  vi.stubEnv('MCP_PREVIEW_SECRET', TEST_PREVIEW_SECRET)
  Object.assign(world, { version: 1, plans: 0, commits: [], blocked: [], nothingToDo: false })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('fase 1 y fase 2', () => {
  test('sin clave: simulado, no escribe, trae resumen, clave y vencimiento de 30 min', async () => {
    const mcp = await connect([twoPhaseTool('prueba_a')])
    try {
      const result = await mcp.call('prueba_a', { nombre: 'uno', cantidad: 3 })
      expect(result.isError, textOf(result)).toBeFalsy()
      const data = parse(textOf(result))
      expect(data).toMatchObject({
        accion: 'simulado',
        escrito: false,
        prueba: { nombre: 'uno' },
        cambios: { cantidad: { antes: 1, ahora: 3 } },
        avisos: ['Un aviso'],
        nota: PHASE_ONE_NOTE,
      })
      expect(data).not.toHaveProperty('bloqueos')
      expect(String(data.clave)).toMatch(/^[\w-]+\.[\w-]+$/)
      expect(new Date(String(data.vence)).getTime() - Date.now()).toBeGreaterThan(29 * 60_000)
      expect(result.structuredContent).toEqual(data)
      expect(world.commits).toEqual([])
    } finally {
      await mcp.close()
    }
  })

  test('con la clave y los mismos datos: escribe una vez, con lo que el plan leyó', async () => {
    const mcp = await connect([twoPhaseTool('prueba_a')])
    try {
      const phaseOne = parse(textOf(await mcp.call('prueba_a', { nombre: 'uno', cantidad: 3 })))
      // Key order and an empty clave do not matter: the arguments are the same.
      const result = await mcp.call('prueba_a', { cantidad: 3, nombre: 'uno', clave: phaseOne.clave })
      expect(result.isError, textOf(result)).toBeFalsy()
      expect(parse(textOf(result))).toMatchObject({ accion: 'creado', escrito: true })
      expect(world.commits).toEqual(['admin-1:uno:v1'])
      expect(world.plans).toBe(2)
    } finally {
      await mcp.close()
    }
  })

  test('la clave se anuncia como opcional en el esquema y el campo desconocido sigue siendo error', async () => {
    const mcp = await connect([twoPhaseTool('prueba_a')])
    try {
      const [tool] = await mcp.tools()
      expect(Object.keys(tool.inputSchema.properties ?? {})).toEqual(['nombre', 'cantidad', 'clave'])
      expect(tool.inputSchema.required).toEqual(['nombre'])
      const unknown = await mcp.call('prueba_a', { nombre: 'uno', confirmar: true })
      expect(unknown.isError).toBe(true)
      expect(world.plans).toBe(0)
    } finally {
      await mcp.close()
    }
  })
})

describe('lo que invalida la clave: nunca escribe', () => {
  async function keyOf(tool: string, args: Record<string, unknown>, user = 'admin-1') {
    const mcp = await connect([twoPhaseTool(tool)], user)
    try {
      return String(parse(textOf(await mcp.call(tool, args))).clave)
    } finally {
      await mcp.close()
    }
  }

  test('otro usuario', async () => {
    const clave = await keyOf('prueba_a', { nombre: 'uno' })
    const other = await connect([twoPhaseTool('prueba_a')], 'admin-2')
    try {
      const result = await other.call('prueba_a', { nombre: 'uno', clave })
      expect(result.isError).toBe(true)
      expect(textOf(result)).toBe('Esa clave es del resumen de otro usuario: pide el tuyo. No escribí nada.')
      expect(world.commits).toEqual([])
    } finally {
      await other.close()
    }
  })

  test('otra herramienta, aunque lleve los mismos datos', async () => {
    const clave = await keyOf('prueba_a', { nombre: 'uno' })
    const mcp = await connect([twoPhaseTool('prueba_b')])
    try {
      const result = await mcp.call('prueba_b', { nombre: 'uno', clave })
      expect(result.isError).toBe(true)
      expect(textOf(result)).toBe('Esa clave es de otra herramienta (prueba_a): pide el resumen de esta. No escribí nada.')
      expect(world.commits).toEqual([])
    } finally {
      await mcp.close()
    }
  })

  test('otros argumentos', async () => {
    const clave = await keyOf('prueba_a', { nombre: 'uno', cantidad: 3 })
    const mcp = await connect([twoPhaseTool('prueba_a')])
    try {
      for (const args of [{ nombre: 'uno', cantidad: 4 }, { nombre: 'dos', cantidad: 3 }, { nombre: 'uno' }]) {
        const result = await mcp.call('prueba_a', { ...args, clave })
        expect(result.isError, JSON.stringify(args)).toBe(true)
        expect(textOf(result)).toBe('Los datos son distintos a los del resumen: pide el resumen de nuevo. No escribí nada.')
      }
      expect(world.commits).toEqual([])
    } finally {
      await mcp.close()
    }
  })

  test('una clave alterada o inventada', async () => {
    const clave = await keyOf('prueba_a', { nombre: 'uno' })
    const [payload] = clave.split('.')
    const mcp = await connect([twoPhaseTool('prueba_a')])
    try {
      for (const bad of [`${payload}.AAAA`, 'abc', `${clave}x`, 'a.b']) {
        const result = await mcp.call('prueba_a', { nombre: 'uno', clave: bad })
        expect(result.isError, bad).toBe(true)
        expect(textOf(result)).toBe('La clave no es válida: pide el resumen de nuevo. No escribí nada.')
      }
      expect(world.commits).toEqual([])
    } finally {
      await mcp.close()
    }
  })

  test('la huella cambió entre las dos fases: dice qué cambió y no escribe', async () => {
    const mcp = await connect([twoPhaseTool('prueba_a')])
    try {
      const clave = parse(textOf(await mcp.call('prueba_a', { nombre: 'uno' }))).clave
      world.version = 2
      const result = await mcp.call('prueba_a', { nombre: 'uno', clave })
      expect(result.isError).toBe(true)
      expect(textOf(result)).toBe('La prueba uno cambió desde el resumen: vuelve a pedirlo. No escribí nada.')
      expect(world.commits).toEqual([])
      // A new summary on the new state works again.
      const again = parse(textOf(await mcp.call('prueba_a', { nombre: 'uno' })))
      const ok = await mcp.call('prueba_a', { nombre: 'uno', clave: again.clave })
      expect(ok.isError).toBeFalsy()
      expect(world.commits).toEqual(['admin-1:uno:v2'])
    } finally {
      await mcp.close()
    }
  })

  test('venció (30 min)', async () => {
    const mcp = await connect([twoPhaseTool('prueba_a')])
    try {
      const clave = parse(textOf(await mcp.call('prueba_a', { nombre: 'uno' }))).clave
      vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 31 * 60_000 })
      const result = await mcp.call('prueba_a', { nombre: 'uno', clave })
      expect(result.isError).toBe(true)
      expect(textOf(result)).toBe('La clave venció (dura 30 min): pide el resumen de nuevo. No escribí nada.')
      expect(world.commits).toEqual([])
    } finally {
      vi.useRealTimers()
      await mcp.close()
    }
  })
})

describe('sin secreto o con bloqueos', () => {
  test('sin MCP_PREVIEW_SECRET (o uno corto) la fase 1 avisa que no hay confirmación y no lee ni escribe nada', async () => {
    const mcp = await connect([twoPhaseTool('prueba_a')])
    try {
      for (const secret of ['', 'demasiado-corto']) {
        vi.stubEnv('MCP_PREVIEW_SECRET', secret)
        const result = await mcp.call('prueba_a', { nombre: 'uno' })
        expect(result.isError, secret).toBe(true)
        expect(textOf(result)).toBe('La confirmación en dos pasos no está disponible en este servidor (falta MCP_PREVIEW_SECRET): no escribí nada.')
      }
      expect(world.plans).toBe(0)
      expect(world.commits).toEqual([])
    } finally {
      await mcp.close()
    }
  })

  test('una clave emitida antes no sirve si el secreto desaparece o cambia', async () => {
    const mcp = await connect([twoPhaseTool('prueba_a')])
    try {
      const clave = parse(textOf(await mcp.call('prueba_a', { nombre: 'uno' }))).clave
      vi.stubEnv('MCP_PREVIEW_SECRET', '')
      expect((await mcp.call('prueba_a', { nombre: 'uno', clave })).isError).toBe(true)
      vi.stubEnv('MCP_PREVIEW_SECRET', `${TEST_PREVIEW_SECRET}-rotado`)
      const rotated = await mcp.call('prueba_a', { nombre: 'uno', clave })
      expect(textOf(rotated)).toBe('La clave no es válida: pide el resumen de nuevo. No escribí nada.')
      expect(world.commits).toEqual([])
    } finally {
      await mcp.close()
    }
  })

  test('con bloqueos la fase 1 no emite clave; si aparecen en la fase 2, no escribe', async () => {
    const mcp = await connect([twoPhaseTool('prueba_a')])
    try {
      const clave = parse(textOf(await mcp.call('prueba_a', { nombre: 'uno' }))).clave
      world.blocked = ['Falta el precio.']
      const phaseOne = parse(textOf(await mcp.call('prueba_a', { nombre: 'uno' })))
      expect(phaseOne).toMatchObject({ accion: 'simulado', escrito: false, bloqueos: ['Falta el precio.'] })
      expect(phaseOne).not.toHaveProperty('clave')
      expect(phaseOne.nota).toMatch(/Hay bloqueos/)
      const result = await mcp.call('prueba_a', { nombre: 'uno', clave })
      expect(result.isError).toBe(true)
      expect(textOf(result)).toBe('Falta el precio. No escribí nada.')
      expect(world.commits).toEqual([])
    } finally {
      await mcp.close()
    }
  })

  test('sin nada que hacer responde sin_cambios y sin clave', async () => {
    world.nothingToDo = true
    const mcp = await connect([twoPhaseTool('prueba_a')])
    try {
      const data = parse(textOf(await mcp.call('prueba_a', { nombre: 'uno' })))
      expect(data).toMatchObject({ accion: 'sin_cambios', escrito: false })
      expect(data).not.toHaveProperty('clave')
      expect(world.commits).toEqual([])
    } finally {
      await mcp.close()
    }
  })

  test('una herramienta que declara `direct` escribe de inmediato lo de bajo riesgo, aun sin secreto; lo demás pide el sí', async () => {
    const mixed = defineTool({
      connector: 'dymmsa',
      name: 'prueba_mixta',
      kind: 'write',
      title: 'Prueba mixta',
      description: 'Herramienta de prueba del núcleo: unas llamadas son directas y otras piden confirmación.',
      input: { nombre: z.string(), delicado: z.boolean().optional() },
      hints: { destructiveHint: true, idempotentHint: false, openWorldHint: false },
      adminOnly: true,
      confirm: 'two_phase',
      direct: true,
      docs: { module: 'Prueba', title: 'Prueba', example: 'Haz la prueba.', limits: 'Solo prueba.' },
      plan: async (input): Promise<WritePlan<null>> => ({
        entity: { key: 'prueba', value: { nombre: input.nombre } },
        directo: !input.delicado,
        bloqueos: world.blocked,
        fingerprint: { version: world.version },
        subject: `La prueba ${input.nombre}`,
        carry: null,
      }),
      commit: async (input, ctx) => {
        world.commits.push(`${ctx.userId}:${input.nombre}`)
        return { accion: 'creado', escrito: true }
      },
    })
    const mcp = await connect([mixed])
    try {
      vi.stubEnv('MCP_PREVIEW_SECRET', '')
      // Low risk: written at once, with no key and no secret.
      const direct = await mcp.call('prueba_mixta', { nombre: 'uno' })
      expect(direct.isError, textOf(direct)).toBeFalsy()
      expect(parse(textOf(direct))).toMatchObject({ accion: 'creado', escrito: true })
      expect(world.commits).toEqual(['admin-1:uno'])
      // Sensitive: it fails closed until the secret exists.
      const sensitive = await mcp.call('prueba_mixta', { nombre: 'dos', delicado: true })
      expect(sensitive.isError).toBe(true)
      expect(textOf(sensitive)).toMatch(/no está disponible/)
      expect(world.commits).toEqual(['admin-1:uno'])

      // With the secret it asks for the yes, and a block is always shown first, even on a low-risk call.
      vi.stubEnv('MCP_PREVIEW_SECRET', TEST_PREVIEW_SECRET)
      const asked = parse(textOf(await mcp.call('prueba_mixta', { nombre: 'dos', delicado: true })))
      expect(asked).toMatchObject({ accion: 'simulado', escrito: false })
      expect(asked.clave).toBeTruthy()
      world.blocked = ['Falta algo.']
      const blocked = parse(textOf(await mcp.call('prueba_mixta', { nombre: 'tres' })))
      expect(blocked).toMatchObject({ accion: 'simulado', escrito: false, bloqueos: ['Falta algo.'] })
      expect(world.commits).toEqual(['admin-1:uno'])
    } finally {
      await mcp.close()
    }
  })

  test('un member no ve la herramienta', async () => {
    const mcp = await connectMcp('member', authAs('member'), { ...dymmsaConnector, tools: [twoPhaseTool('prueba_a'), getAppSettingsTool] })
    try {
      expect((await mcp.tools()).map((t) => t.name)).toEqual(['get_app_settings'])
    } finally {
      await mcp.close()
    }
  })
})
