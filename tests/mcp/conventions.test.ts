/** The conventions of the DYMMSA-WEB connector (#155 C6, ADR-041 §6-§9): Spanish tokens, one name lookup, refs and versions. */

import { describe, test, expect } from 'vitest'
import { createMockSupabase, type CallRecord } from '../helpers/supabase-mock'
import { tokenMap, approvalToken, soldToken } from '@/lib/tokens'
import { QUOTATION_STATUS_TOKENS } from '@/lib/quotation-status'
import { ORDER_STATUS_TOKENS, URREA_STATUS_TOKENS } from '@/lib/order-status'
import { DELIVERY_TIME_TOKENS } from '@/lib/delivery'
import { STOCK_FILTER_TOKENS } from '@/lib/stock-filters'
import { PAYABLE_FILTER_TOKENS, PAYABLE_STATUS_TOKENS } from '@/lib/payables'
import { TASK_CLOSE_REASON_TOKENS, TASK_PRIORITY_TOKENS, TASK_STATE_TOKENS } from '@/lib/github'
import { AREA_TOKENS, ROLE_TOKENS } from '@/lib/profile'
import { EXCUSE_TOKENS, SHIFT_TOKENS } from '@/lib/timesheet'
import { resolveByName, requireSingleMatch, type NamedLookup } from '@/lib/mcp/core/lookup'
import { refOf, versionOf } from '@/lib/mcp/core/envelope'
import { BUSINESS_RULES_MD } from '@/lib/mcp/server'
import { dymmsaConnector } from '@/lib/mcp/connectors/dymmsa/connector'
import { odooConnector } from '@/lib/mcp/connectors/odoo/connector'
import { CONNECTOR_NAMES } from '@/lib/mcp/core/routes'
import type { Db } from '@/lib/mcp/core/db'

const asDb = (c: ReturnType<typeof createMockSupabase>) => c as unknown as Db

const MAPS = {
  QUOTATION_STATUS_TOKENS, ORDER_STATUS_TOKENS, URREA_STATUS_TOKENS, DELIVERY_TIME_TOKENS, STOCK_FILTER_TOKENS,
  PAYABLE_STATUS_TOKENS, PAYABLE_FILTER_TOKENS, TASK_PRIORITY_TOKENS, TASK_STATE_TOKENS, TASK_CLOSE_REASON_TOKENS,
  ROLE_TOKENS, AREA_TOKENS, SHIFT_TOKENS, EXCUSE_TOKENS,
} as const

describe('tokens en español (ADR-041 §7)', () => {
  test.each(Object.entries(MAPS))('%s: ida y vuelta, sin repetidos, snake_case sin acentos', (_name, map) => {
    expect(new Set(map.tokens).size).toBe(map.tokens.length)
    for (const token of map.tokens) {
      expect(token).toMatch(/^[a-z0-9_]+$/)
      const db = map.toDb(token)
      expect(db, token).toBeDefined()
      expect(map.toToken(db as never)).toBe(token)
    }
  })

  test('el valor de la BD en inglés ya no es un token, y un desconocido tampoco', () => {
    expect(QUOTATION_STATUS_TOKENS.toDb('approved')).toBeUndefined()
    expect(QUOTATION_STATUS_TOKENS.toDb('sent_for_approval')).toBeUndefined()
    expect(ORDER_STATUS_TOKENS.toDb('cancelled')).toBeUndefined()
    expect(PAYABLE_FILTER_TOKENS.toDb('overdue')).toBeUndefined()
    expect(TASK_STATE_TOKENS.toDb('open')).toBeUndefined()
    expect(QUOTATION_STATUS_TOKENS.toDb('')).toBeUndefined()
  })

  test('los tokens de la cotización y la orden siguen el flujo y mapean a la BD', () => {
    expect(QUOTATION_STATUS_TOKENS.tokens).toEqual(['borrador', 'en_revision', 'aprobada', 'rechazada', 'convertida'])
    expect(ORDER_STATUS_TOKENS.tokens).toEqual(['pedida', 'recibida', 'entregada', 'completada', 'cancelada'])
    expect(QUOTATION_STATUS_TOKENS.toDb('en_revision')).toBe('sent_for_approval')
    expect(QUOTATION_STATUS_TOKENS.toDb('convertida')).toBe('converted_to_order')
    expect(DELIVERY_TIME_TOKENS.toToken('2_3_days')).toBe('2_3_dias')
    expect(PAYABLE_FILTER_TOKENS.toDb('vencida')).toBe('overdue')
  })

  test('dos valores con el mismo token no se aceptan', () => {
    expect(() => tokenMap({ a: 'x', b: 'x' })).toThrow(/share a token/)
  })

  test('aprobación y se_vende: el tri-estado en una palabra', () => {
    expect([null, true, false, undefined].map(approvalToken)).toEqual(['pendiente', 'aprobada', 'rechazada', 'pendiente'])
    expect([null, true, false, undefined].map(soldToken)).toEqual(['sin_definir', 'si', 'no', 'sin_definir'])
  })

  test('las reglas de negocio hablan con los mismos tokens y ya no con los de la BD', () => {
    for (const token of [...QUOTATION_STATUS_TOKENS.tokens, ...ORDER_STATUS_TOKENS.tokens]) expect(BUSINESS_RULES_MD, token).toContain(token)
    expect(BUSINESS_RULES_MD).toContain('borrador → en_revision → aprobada | rechazada → convertida')
    expect(BUSINESS_RULES_MD).toContain('pedida → recibida → entregada → completada | cancelada')
    for (const old of ['draft', 'sent_for_approval', 'converted_to_order', 'is_sold', 'is_approved', 'item_type', 'urrea_status', 'paid_at', 'approval_token', 'quantity_', 'low_stock']) {
      expect(BUSINESS_RULES_MD, old).not.toContain(old)
    }
  })
})

describe('resolveByName (ADR-041 §3)', () => {
  const A = '3f2a9c1b-5d7e-4a10-8b31-0123456789ab'
  const B = '3f2a9c1b-ffff-4a10-8b31-0123456789cd'
  const LOOKUP: NamedLookup<{ id: string; name: string }> = {
    table: 'things',
    select: 'id, name',
    what: 'cosa',
    article: 'la',
    label: (row) => row.name,
  }
  const thing = (id: string, name: string) => ({ id, name })

  test('un UUID busca por id; si no existe lo dice sin adivinar', async () => {
    const found = createMockSupabase({ responses: { things: { data: thing(A, 'Una'), error: null } } })
    expect(await resolveByName(asDb(found), LOOKUP, A)).toEqual(thing(A, 'Una'))
    expect(found.callsTo('things', 'select')[0].filters).toEqual([{ method: 'eq', args: ['id', A] }])
    const none = createMockSupabase({ responses: { things: { data: null, error: null } } })
    await expect(resolveByName(asDb(none), LOOKUP, A)).rejects.toThrow('No encontré la cosa con ese id.')
  })

  test('un ref (8 hex, mayúsculas o no) busca el rango del UUID; con dos hits lista ambos con su ref', async () => {
    const one = createMockSupabase({ responses: { things: { data: [thing(A, 'Una')], error: null } } })
    expect(await resolveByName(asDb(one), LOOKUP, ' 3F2A9C1B ')).toEqual(thing(A, 'Una'))
    const filters = one.callsTo('things', 'select')[0].filters
    expect(filters).toContainEqual({ method: 'gte', args: ['id', '3f2a9c1b-0000-0000-0000-000000000000'] })
    expect(filters).toContainEqual({ method: 'lte', args: ['id', '3f2a9c1b-ffff-ffff-ffff-ffffffffffff'] })

    const two = createMockSupabase({ responses: { things: { data: [thing(A, 'Una'), thing(B, 'Otra')], error: null } } })
    await expect(resolveByName(asDb(two), LOOKUP, '3f2a9c1b')).rejects.toThrow(
      'Hay 2 coincidencias (Una [ref 3f2a9c1b], Otra [ref 3f2a9c1b]) — repite con el nombre completo o con su ref.',
    )
  })

  test('un nombre que parece ref pero no pega con ningún id se busca como nombre', async () => {
    const client = createMockSupabase({
      responses: { things: (rec: CallRecord) => ({ data: rec.filters.some((f) => f.method === 'gte') ? [] : [thing(A, 'deadbeef')], error: null }) },
    })
    expect(await resolveByName(asDb(client), LOOKUP, 'deadbeef')).toEqual(thing(A, 'deadbeef'))
    expect(client.callsTo('things', 'select')).toHaveLength(2)
  })

  test('por nombre: ilike sobre las columnas, sin comodines peligrosos, y hasta 5 candidatos con «más de 5»', async () => {
    const many = Array.from({ length: 6 }, (_, i) => thing(`3f2a9c1b-0000-4a10-8b31-01234567890${i}`, `Cosa ${i}`))
    const client = createMockSupabase({ responses: { things: { data: many, error: null } } })
    await expect(resolveByName(asDb(client), { ...LOOKUP, nameColumns: ['name', 'owner'] }, 'co%sa')).rejects.toThrow(/Hay más de 5 coincidencias \(Cosa 0 .*Cosa 4 .*, …\)/)
    const or = client.callsTo('things', 'select')[0].filters.find((f) => f.method === 'or')?.args[0]
    expect(or).toBe('name.ilike.%co sa%,owner.ilike.%co sa%')
  })

  test('sin coincidencias: el mensaje por default, o el propio de quien busca', async () => {
    const client = createMockSupabase({ responses: { things: { data: [], error: null } } })
    await expect(resolveByName(asDb(client), LOOKUP, 'zzz')).rejects.toThrow('No hay cosa que coincida con "zzz".')
    await expect(resolveByName(asDb(client), { ...LOOKUP, notFound: (q) => `Nadie se llama ${q}` }, 'zzz')).rejects.toThrow('Nadie se llama zzz')
    await expect(resolveByName(asDb(client), LOOKUP, '   ')).rejects.toThrow('Indica la cosa (nombre o ref).')
  })

  test('una búsqueda propia reemplaza al ilike', async () => {
    const client = createMockSupabase()
    const search = async (_db: Db, query: string) => [thing(A, `hallada ${query}`)]
    expect(await resolveByName(asDb(client), { ...LOOKUP, search }, 'x')).toEqual(thing(A, 'hallada x'))
    expect(client.callsTo('things')).toEqual([])
  })

  test('requireSingleMatch sigue siendo la guarda de siempre', () => {
    expect(requireSingleMatch(['uno'], (m) => m, 'cosa', 'q')).toBe('uno')
    expect(() => requireSingleMatch([], (m) => m, 'cosa', 'q')).toThrow('No hay cosa que coincida con "q".')
  })
})

describe('ref y version', () => {
  test('el ref son los 8 primeros caracteres del UUID en minúsculas; algo que no es UUID no tiene ref', () => {
    expect(refOf('3F2A9C1B-5D7E-4A10-8B31-0123456789AB')).toBe('3f2a9c1b')
    expect(() => refOf('p1')).toThrow(/not a UUID/)
  })

  test('la version depende de los ids de las líneas, de su orden y de updated_at', () => {
    const base = versionOf('2026-10-01T10:00:00Z', ['a', 'b'])
    expect(versionOf('2026-10-01T10:00:00Z', ['a', 'b'])).toBe(base)
    expect(versionOf('2026-10-01T10:00:01Z', ['a', 'b'])).not.toBe(base)
    expect(versionOf('2026-10-01T10:00:00Z', ['b', 'a'])).not.toBe(base)
    expect(versionOf('2026-10-01T10:00:00Z', ['a'])).not.toBe(base)
  })
})

describe('verbos y parámetros de DYMMSA-WEB (ADR-041 §6-§7)', () => {
  const ENGLISH_PARAMS = ['query', 'search', 'page', 'pageSize', 'limit', 'status', 'state', 'priority', 'id', 'number', 'model_code', 'location', 'comment', 'title', 'description', 'task_number', 'stockFilter']

  test('cada tool arranca con uno de los verbos del catálogo: nunca set_, mark_, create_, update_ ni record_', () => {
    for (const tool of dymmsaConnector.tools) {
      expect(tool.name, tool.name).toMatch(/^(get|list|search|preview|save)_[a-z_]+$|^delete_record$/)
    }
  })

  test('los parámetros van en español, snake_case y sin acentos', () => {
    for (const tool of dymmsaConnector.tools) {
      for (const key of Object.keys(tool.input)) {
        expect(key, `${tool.name}.${key}`).toMatch(/^[a-z][a-z0-9_]*$/)
        expect(ENGLISH_PARAMS, `${tool.name}.${key} está en inglés`).not.toContain(key)
      }
    }
  })

  test('una lectura o escritura que lista paginado usa pagina y por_pagina', () => {
    for (const tool of dymmsaConnector.tools.filter((t) => 'pagina' in t.input)) {
      expect(Object.keys(tool.input), tool.name).not.toContain('page')
    }
  })
})

describe('serverInfo (#155 B3, C6)', () => {
  test.each([
    ['dymmsa', dymmsaConnector],
    ['odoo', odooConnector],
  ] as const)('el título de %s es el nombre con el que se agrega en Claude (CONNECTOR_NAMES)', (id, connector) => {
    expect(connector.serverInfo.title).toBe(CONNECTOR_NAMES[id])
    expect(connector.id).toBe(id)
  })
})
