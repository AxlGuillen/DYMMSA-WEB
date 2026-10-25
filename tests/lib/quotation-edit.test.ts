/** quotation-edit (#155 D): the pure part of editing a quotation by line, and the store's status and lookup helpers. */

import { describe, test, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { applyLineChanges, EditError, newSeparator, prefillLine, toItemRow, type LineChange } from '@/lib/quotation-edit'
import { assertManualStatus, linkedOrderBlocks, lookupEtms, QuotationError, sendForApproval, setQuotationStatus } from '@/lib/quotations-store'
import { createMockSupabase, type CallRecord } from '../helpers/supabase-mock'
import type { QuotationItem, QuotationItemRow } from '@/types/database'

const asDb = (mock: ReturnType<typeof createMockSupabase>) => mock as unknown as SupabaseClient
const row = (etm: string, over: Partial<QuotationItemRow> = {}): QuotationItemRow => ({ ...prefillLine({ etm, quantity: 1, unit_price: 10 }, null), _id: etm, _dbId: etm, ...over })
const etmsOf = (rows: readonly QuotationItemRow[]) => rows.map((r) => r.etm || r.section_label)

describe('toItemRow', () => {
  test('una línea guardada vuelve a ser editable con su id real', () => {
    const stored = { id: 'i1', item_type: 'product', section_label: null, separator_color: null, etm: 'E1', description: null, description_es: 'Algo', dymmsa_description: null, model_code: 'M', brand: null, unit_price: 5, quantity: 2, is_approved: true, is_sold: null, delivery_time: null } as unknown as QuotationItem
    expect(toItemRow(stored)).toMatchObject({ _id: 'i1', _dbId: 'i1', etm: 'E1', description: '', description_es: 'Algo', brand: '', delivery_time: 'immediate', is_approved: true, _inDb: true })
  })
})

describe('prefillLine (el merge del cotizador)', () => {
  const product = { description: 'Cat', description_es: 'Catálogo', model_code: 'MC', brand: 'URREA', price: 50, is_sold: false, dymmsa_description: 'Curada' }

  test('el catálogo gana descripción, código y marca; la línea gana cantidad y precio; hereda se_vende y la curada', () => {
    expect(prefillLine({ etm: 'E', quantity: 3, unit_price: 70, model_code: 'X', brand: 'FOY', description: 'mía' }, product)).toMatchObject({
      description: 'Cat', description_es: 'Catálogo', model_code: 'MC', brand: 'URREA', unit_price: 70, quantity: 3, is_sold: false, dymmsa_description: 'Curada', delivery_time: 'immediate', _inDb: true,
    })
  })

  test('sin precio usa el del catálogo; sin catálogo usa lo que se mandó y queda marcada como nueva', () => {
    expect(prefillLine({ etm: 'E', quantity: 1 }, product).unit_price).toBe(50)
    expect(prefillLine({ etm: 'N', quantity: 2, unit_price: 9, model_code: 'NX', description: 'Nueva' }, null)).toMatchObject({
      description: 'Nueva', description_es: 'Nueva', model_code: 'NX', brand: '', unit_price: 9, is_sold: null, _inDb: false,
    })
  })
})

describe('applyLineChanges', () => {
  const base = () => [newSeparator('A', null), row('E1'), row('E2'), row('E3')]

  test('editar toca solo las líneas nombradas; «todas» salta las secciones', () => {
    const { rows } = applyLineChanges(base(), [
      { kind: 'set', lines: [3], set: { unit_price: 99 } },
      { kind: 'set', lines: 'all', set: { delivery_time: '1_week' } },
    ])
    expect(rows.map((r) => r.unit_price)).toEqual([null, 10, 99, 10])
    expect(rows.map((r) => r.delivery_time)).toEqual(['immediate', '1_week', '1_week', '1_week'])
  })

  test('las posiciones son las leídas, sin importar el orden de las operaciones', () => {
    const changes: LineChange[] = [
      { kind: 'remove', line: 2 },
      { kind: 'set', lines: [4], set: { quantity: 7 } },
    ]
    const forward = applyLineChanges(base(), changes)
    const backward = applyLineChanges(base(), [...changes].reverse())
    expect(etmsOf(forward.rows)).toEqual(['A', 'E2', 'E3'])
    expect(forward.rows[2].quantity).toBe(7)
    expect(etmsOf(backward.rows)).toEqual(etmsOf(forward.rows))
    expect(forward.origin).toEqual([1, 3, 4])
  })

  test('mover y agregar cuelgan de una línea leída (0 = al inicio, sin ancla = al final) y distinguen lo movido de lo recorrido', () => {
    const applied = applyLineChanges(base(), [
      { kind: 'move', line: 4, after: 1 },
      { kind: 'add', row: row('N1'), after: 0 },
      { kind: 'add', row: row('N2') },
      { kind: 'remove', line: 3 },
    ])
    expect(etmsOf(applied.rows)).toEqual(['N1', 'A', 'E3', 'E1', 'N2'])
    expect(applied.origin).toEqual([null, 1, 4, 2, null])
    expect([...applied.moved]).toEqual([4])
  })

  test('errores con la línea y qué hacer: guarda, rango, sección, ancla quitada', () => {
    const fail = (changes: LineChange[]) => {
      try {
        applyLineChanges(base(), changes)
      } catch (error) {
        expect(error).toBeInstanceOf(EditError)
        return (error as Error).message
      }
      return null
    }
    expect(fail([{ kind: 'remove', line: 2, guard: 'OTRO' }])).toBe('La línea 2 es el ETM E1, no OTRO: vuelve a leer la cotización.')
    expect(fail([{ kind: 'set', lines: [9], set: { quantity: 1 } }])).toBe('No hay línea 9: la cotización tiene 4.')
    expect(fail([{ kind: 'set', lines: [1], set: { quantity: 1 } }])).toMatch(/La línea 1 es una sección/)
    expect(fail([{ kind: 'remove', line: 2, guard: 'e1' }])).toBeNull()
    expect(fail([{ kind: 'remove', line: 3 }, { kind: 'add', row: row('N'), after: 3 }])).toBe('La línea 3 se quita en la misma llamada: elige otra posición.')
    expect(fail([{ kind: 'move', line: 2, after: 2 }])).toBe('La línea 2 no puede ir después de sí misma.')
    expect(fail([{ kind: 'remove', line: 2 }, { kind: 'move', line: 2, after: 3 }])).toBe('La línea 2 se quita y se mueve en la misma llamada.')
  })

  test('aprobar una línea «no lo vendemos»: error si se nombra, se salta si es un barrido', () => {
    const rows = [row('E1', { is_sold: false }), row('E2')]
    expect(() => applyLineChanges(rows, [{ kind: 'set', lines: [1], set: { is_approved: true } }])).toThrow(/no se puede aprobar/)
    const swept = applyLineChanges(rows, [{ kind: 'set', lines: 'all', set: { is_approved: true } }])
    expect(swept.rows.map((r) => r.is_approved)).toEqual([undefined, true])
  })

  test('no muta las filas que recibe', () => {
    const original = base()
    applyLineChanges(original, [{ kind: 'set', lines: [2], set: { unit_price: 1 } }])
    expect(original[1].unit_price).toBe(10)
  })
})

describe('setQuotationStatus / sendForApproval', () => {
  const QUOTATION = { id: 'q1', status: 'draft', approved_at: null, approval_token: 'tok' }

  test('solo los estados manuales; «convertida» se asigna al generar la orden', async () => {
    expect(() => assertManualStatus('converted_to_order')).toThrow(QuotationError)
    expect(() => assertManualStatus('approved')).not.toThrow()
    await expect(setQuotationStatus(asDb(createMockSupabase()), 'q1', 'pagada')).rejects.toMatchObject({ status: 400 })
  })

  test('cada cambio regenera el token; aprobar sella la fecha una vez; una cotización que no existe es 404', async () => {
    const db = createMockSupabase({ responses: { 'quotations.select': { data: QUOTATION, error: null }, 'quotations.update': { data: { id: 'q1' }, error: null } } })
    await setQuotationStatus(asDb(db), 'q1', 'approved')
    const payload = db.updatePayload<Record<string, string>>('quotations')
    expect(payload.status).toBe('approved')
    expect(payload.approval_token).toMatch(/^[0-9a-f-]{36}$/)
    expect(payload.approved_at).toMatch(/^20/)

    const sealed = createMockSupabase({ responses: { 'quotations.select': { data: { ...QUOTATION, approved_at: '2026-01-01' }, error: null }, 'quotations.update': { data: { id: 'q1' }, error: null } } })
    await setQuotationStatus(asDb(sealed), 'q1', 'approved')
    expect(sealed.updatePayload<Record<string, unknown>>('quotations').approved_at).toBeUndefined()

    const missing = createMockSupabase({ responses: { 'quotations.select': { data: null, error: { code: 'PGRST116' } } } })
    await expect(setQuotationStatus(asDb(missing), 'q1', 'draft')).rejects.toMatchObject({ status: 404 })
  })

  test('reabrir una convertida exige que su orden ya no exista, y un error al buscarla es 500 (cierra)', async () => {
    const converted = { ...QUOTATION, status: 'converted_to_order' }
    const withOrder = createMockSupabase({ responses: { 'quotations.select': { data: converted, error: null }, 'orders.select': { data: [{ id: 'o1' }], error: null } } })
    await expect(setQuotationStatus(asDb(withOrder), 'q1', 'draft')).rejects.toThrow('Elimina la orden vinculada antes de reabrir esta cotización.')
    const broken = createMockSupabase({ responses: { 'orders.select': { data: null, error: { message: 'boom' } } } })
    await expect(linkedOrderBlocks(asDb(broken), 'q1')).rejects.toMatchObject({ status: 500 })
  })

  test('enviar a aprobación solo desde borrador y sin tocar el token', async () => {
    const db = createMockSupabase({ responses: { 'quotations.select': { data: QUOTATION, error: null }, 'quotations.update': { data: { approval_token: 'tok' }, error: null } } })
    expect(await sendForApproval(asDb(db), 'q1')).toEqual({ approval_token: 'tok' })
    expect(db.updatePayload('quotations')).toEqual({ status: 'sent_for_approval' })
    const sent = createMockSupabase({ responses: { 'quotations.select': { data: { ...QUOTATION, status: 'approved' }, error: null } } })
    await expect(sendForApproval(asDb(sent), 'q1')).rejects.toThrow('No se puede enviar a aprobación una cotización en estado "approved"')
  })
})

describe('lookupEtms', () => {
  test('separa los encontrados de los que no y trae solo las descripciones oficiales con texto', async () => {
    const db = createMockSupabase({
      responses: {
        'etm_products.select': { data: [{ etm: 'E1', model_code: 'MC1' }], error: null },
        'urrea_catalog.select': (rec: CallRecord) => ({ data: rec.table === 'urrea_catalog' ? [{ code: 'MC1', brand: 'URREA', description: 'Oficial' }, { code: 'MC9', brand: 'URREA', description: ' ' }] : [], error: null }),
      },
    })
    const result = await lookupEtms(asDb(db), ['E1', 'E2'], ['MC9'])
    expect(result.notFound).toEqual(['E2'])
    expect(result.found).toHaveLength(1)
    expect(result.catalogDescriptions).toEqual({ 'URREA|MC1': 'Oficial' })
  })

  test('un fallo de lectura es 500 con el mensaje de siempre', async () => {
    const db = createMockSupabase({ responses: { 'etm_products.select': { data: null, error: { message: 'boom' } } } })
    await expect(lookupEtms(asDb(db), ['E1'])).rejects.toMatchObject({ status: 500, message: 'Error en la consulta' })
  })
})
