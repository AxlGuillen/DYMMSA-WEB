/** requireLiveAdmin (#144, ADR-040): the token's role AND a fresh read of profiles, or no proof. */

import { describe, test, expect, vi, afterEach } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { createMockSupabase, filterValue, type MockSupabaseClient } from '../helpers/supabase-mock'
import { isAdminNow, LIVE_ADMIN_READ_TIMEOUT_MS, requireLiveAdmin, ToolError, type Db } from '@/lib/mcp/shared'
import { PRE_TOOL_HEADROOM_MS } from '@/lib/odoo/deadline'
import { grantPreviewWrite, issueQuotationKey, PREVIEW_EXPIRED_MESSAGE, verifyQuotationKey } from '@/lib/odoo/preview-token'
import { ADMIN_ONLY_MESSAGE, assertAdminProof } from '@/lib/odoo/write-guard'
import type { McpRole } from '@/lib/mcp/manifest'

const asDb = (c: MockSupabaseClient) => c as unknown as Db

function ctxWith(profile: Parameters<typeof createMockSupabase>[0], role: McpRole = 'admin', userId = 'u-admin') {
  const client = createMockSupabase(profile)
  return { client, ctx: { db: asDb(client), userId, role } }
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

/** src/ files with their POSIX path, for the call-site scan. */
function sources(dir = join(process.cwd(), 'src'), out: { path: string; text: string }[] = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) sources(full, out)
    else if (/\.(ts|tsx)$/.test(entry)) out.push({ path: relative(process.cwd(), full).split(sep).join('/'), text: readFileSync(full, 'utf8') })
  }
  return out
}

describe('requireLiveAdmin (#144)', () => {
  test('un member, un admin degradado o un error de BD no obtienen prueba', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    // Member by the token: not even the profiles read happens.
    const member = ctxWith({ responses: { profiles: { data: { role: 'admin', display_name: 'Ana' } } } }, 'member')
    await expect(requireLiveAdmin(member.ctx)).rejects.toThrow(ADMIN_ONLY_MESSAGE)
    expect(member.client._calls).toEqual([])

    const cases = {
      'degradado tras emitir el token': { data: { role: 'member', display_name: 'Ana' } },
      'sin fila visible': { data: null },
      'error de BD': { data: null, error: { message: 'boom' } },
      'sin nombre': { data: { role: 'admin', display_name: '   ' } },
      'nombre que no es texto': { data: { role: 'admin', display_name: 7 } },
    }
    for (const [label, response] of Object.entries(cases)) {
      const { ctx } = ctxWith({ responses: { profiles: response } })
      const error = await requireLiveAdmin(ctx).catch((e: unknown) => e)
      expect(error, label).toBeInstanceOf(ToolError)
      expect((error as Error).message, label).toBe(ADMIN_ONLY_MESSAGE)
    }
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('no se pudo releer el rol'), 'boom')

    // A client that throws instead of answering is still "not an admin".
    const throwing = { from: () => { throw new Error('network down') } } as unknown as Db
    await expect(requireLiveAdmin({ db: throwing, userId: 'u-admin', role: 'admin' })).rejects.toThrow(ADMIN_ONLY_MESSAGE)
    // No user id, no proof.
    await expect(requireLiveAdmin({ ...ctxWith({}).ctx, userId: '' })).rejects.toThrow(ADMIN_ONLY_MESSAGE)
  })

  test('la prueba lleva el display_name', async () => {
    const { client, ctx } = ctxWith({ responses: { profiles: { data: { role: 'admin', display_name: '  Axl Guillén ' } } } })
    const proof = await requireLiveAdmin(ctx)

    expect(proof).toMatchObject({ userId: 'u-admin', displayName: 'Axl Guillén' })
    expect(() => assertAdminProof(proof)).not.toThrow()
    const [read] = client.callsTo('profiles', 'select')
    expect(filterValue(read, 'id')).toBe('u-admin')
    expect(read.single).toBe(true)
  })

  test('la lectura del rol tiene tope: corre antes del plazo de la tool', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout')
    const { client, ctx } = ctxWith({ responses: { profiles: { data: { role: 'admin', display_name: 'Ana' } } } })
    await requireLiveAdmin(ctx)
    expect(timeout).toHaveBeenCalledWith(LIVE_ADMIN_READ_TIMEOUT_MS)
    const [read] = client.callsTo('profiles', 'select')
    const signal = read.filters.find((f) => f.method === 'abortSignal')?.args[0]
    expect(signal).toBeInstanceOf(AbortSignal)
    expect(LIVE_ADMIN_READ_TIMEOUT_MS).toBeLessThan(PRE_TOOL_HEADROOM_MS)
  })

  test('cada llamada relee profiles: sin caché de rol', async () => {
    let role = 'admin'
    const { client, ctx } = ctxWith({ responses: { profiles: () => ({ data: { role, display_name: 'Ana' } }) } })
    await expect(requireLiveAdmin(ctx)).resolves.toMatchObject({ displayName: 'Ana' })
    role = 'member'
    await expect(requireLiveAdmin(ctx)).rejects.toThrow(ADMIN_ONLY_MESSAGE)
    expect(client.callsTo('profiles', 'select')).toHaveLength(2)
  })
})

describe('requireLiveAdmin en las tools (#144)', () => {
  test('cada tool le pasa el contexto del handler tal cual', () => {
    const argsOf = (text: string) => [...text.matchAll(/\brequireLiveAdmin\(([^)]*)\)/g)].map((m) => m[1].trim())
    // A spread or a hand-built context could sign the trail with another admin's name.
    expect(argsOf('await requireLiveAdmin(ctx); requireLiveAdmin({ ...ctx, userId }); requireLiveAdmin(other)')).toEqual([
      'ctx',
      '{ ...ctx, userId }',
      'other',
    ])
    for (const file of sources().filter((f) => f.path !== 'src/lib/mcp/core/auth/live-admin.ts')) {
      for (const arg of argsOf(file.text)) expect(arg, file.path).toBe('ctx')
    }
  })

  test('un solo reloj: con vi.setSystemTime la prueba, la clave y su vencimiento avanzan juntos', async () => {
    vi.stubEnv('ODOO_URL', 'https://odoo.test')
    vi.stubEnv('ODOO_WRITE_API_KEY', 'write-key-0123456789abcdef')
    vi.useFakeTimers({ toFake: ['Date'], now: Date.UTC(2026, 9, 17, 22, 0) })
    const { ctx } = ctxWith({ responses: { profiles: { data: { role: 'admin', display_name: 'Ana' } } } })
    const target = { kind: 'crear' as const, input: { cliente: '#1' }, partnerId: 1, saleId: null, writeDate: null }

    // Like a tool: no injected `now` anywhere, requireLiveAdmin stamps with Date.now().
    const { clave, markers } = issueQuotationKey(await requireLiveAdmin(ctx), target)
    vi.setSystemTime(Date.now() + 31 * 60_000)
    const verified = verifyQuotationKey(await requireLiveAdmin(ctx), clave, { kind: 'crear', input: target.input })
    // Past 30 min the "ya estaba" lookup still has its marker; the write does not.
    expect(verified).toMatchObject({ expired: true, markers })
    expect(() => grantPreviewWrite(verified)).toThrow(PREVIEW_EXPIRED_MESSAGE)
  })
})

describe('isAdminNow (movido desde payables)', () => {
  test('solo un rol admin leído con el token cuenta como administrador', async () => {
    const read = (response: Parameters<typeof createMockSupabase>[0]) => isAdminNow(asDb(createMockSupabase(response)), 'u-1')
    expect(await read({ responses: { profiles: { data: { role: 'admin' } } } })).toBe(true)
    expect(await read({ responses: { profiles: { data: { role: 'member' } } } })).toBe(false)
    expect(await read({ responses: { profiles: { data: null } } })).toBe(false)
    expect(await read({ responses: { profiles: { data: null, error: { message: 'boom' } } } })).toBe(false)
  })
})
