/** Pure parts of the quotation stores (#157): the server-side validation of a save/edit and of the
 *  public approval payload, and the QuotationError → HTTP mapping. The writes are covered in tests/api. */

import { describe, test, expect } from 'vitest'
import { parseQuotationInput, QuotationError } from '@/lib/quotations-store'
import { parseApprovalInput, STALE_ITEMS_CODE } from '@/lib/approval-store'
import { quotationItem as product, separator } from '../helpers/factories'

const ID = '33333333-3333-4333-8333-000000000001'

function parseError(body: unknown): QuotationError {
  try {
    parseQuotationInput(body)
  } catch (error) {
    if (error instanceof QuotationError) return error
    throw error
  }
  throw new Error('parseQuotationInput no lanzó')
}

describe('parseQuotationInput', () => {
  test('recorta encabezado y devuelve las líneas tal cual', () => {
    const items = [product(), separator()]
    expect(parseQuotationInput({ name: ' Q ', customer_name: ' ACME ', items })).toEqual({
      name: 'Q', customer_name: 'ACME', items,
    })
  })

  test('encabezado vacío, sin productos o items mal formados → 400', () => {
    expect(parseError({ name: '', customer_name: 'A', items: [product()] }).message).toMatch(/nombre de la cotización/)
    expect(parseError({ name: 'Q', customer_name: ' ', items: [product()] }).message).toMatch(/nombre del cliente/)
    expect(parseError({ name: 'Q', customer_name: 'A', items: [separator()] }).message).toMatch(/al menos un producto/)
    expect(parseError({ name: 'Q', customer_name: 'A', items: [product(), 'x'] }).message).toBe('Payload inválido')
    expect(parseError(null).status).toBe(400)
  })

  test('misma validación que el cotizador: el primer problema con su ETM y cuántos más hay', () => {
    const error = parseError({
      name: 'Q', customer_name: 'A',
      items: [product({ etm: 'A1', quantity: 0 }), product({ etm: 'A2', unit_price: -1 }), product({ etm: '' })],
    })
    expect(error).toMatchObject({ kind: 'invalid', offendingEtm: 'A1', status: 400 })
    expect(error.message).toMatch(/^ETM "A1": la cantidad/)
    expect(error.message).toMatch(/Hay 2 problemas más\.$/)
  })

  test('separadores y "no lo vendemos" quedan exentos; un warning (sin model_code) no bloquea', () => {
    expect(() => parseQuotationInput({
      name: 'Q', customer_name: 'A',
      items: [
        product({ model_code: '' }),
        product({ is_sold: false, quantity: null, unit_price: null, etm: '' }),
        separator({ quantity: 0 }),
      ],
    })).not.toThrow()
  })

  test('enums y números que la BD rechazaría → 400 con el ETM', () => {
    expect(parseError({ name: 'Q', customer_name: 'A', items: [product({ etm: 'E1', delivery_time: 'mañana' })] }))
      .toMatchObject({ offendingEtm: 'E1', message: expect.stringMatching(/tiempo de entrega inválido/) })
    expect(parseError({ name: 'Q', customer_name: 'A', items: [product(), { _id: 'x', item_type: 'nota' }] }).message)
      .toMatch(/Tipo de línea inválido/)
    expect(parseError({ name: 'Q', customer_name: 'A', items: [product({ etm: 'E2', unit_price: '100' })] }).message)
      .toMatch(/E2.*precio debe ser un número/)
    // A non-boolean reaches the DB as 22P02 (500) without this check (review PR #166).
    expect(parseError({ name: 'Q', customer_name: 'A', items: [product({ etm: 'E3', is_sold: 'si' })] }))
      .toMatchObject({ offendingEtm: 'E3', message: expect.stringMatching(/lo vendemos/) })
    expect(parseError({ name: 'Q', customer_name: 'A', items: [product({ etm: 'E4', is_approved: 1 })] }).message)
      .toMatch(/E4.*aprobación/)
  })
})

describe('parseApprovalInput', () => {
  test('dedupe de ids y finalize default false', () => {
    expect(parseApprovalInput({ approvedIds: [ID, ID] })).toEqual({ approvedIds: [ID], finalize: false })
    expect(parseApprovalInput({})).toEqual({ approvedIds: [], finalize: false })
    expect(parseApprovalInput({ approvedIds: [], finalize: true }).finalize).toBe(true)
  })

  test('cualquier cosa que no venga de la página → 400, nunca "aprobar nada"', () => {
    for (const body of [null, 'x', [ID], { approvedIds: 'x' }, { approvedIds: ['no-uuid'] }, { approvedIds: [1] }, { finalize: 'yes' }]) {
      expect(() => parseApprovalInput(body), JSON.stringify(body)).toThrow(QuotationError)
    }
  })
})

describe('QuotationError', () => {
  test('kind → status y el body solo lleva lo que existe', () => {
    expect(new QuotationError('x').status).toBe(400)
    expect(new QuotationError('x', 'not_found').status).toBe(404)
    expect(new QuotationError('x', 'conflict', undefined, STALE_ITEMS_CODE).body).toEqual({ message: 'x', code: 'stale_items' })
    expect(new QuotationError('x', 'failed', 'E1').body).toEqual({ message: 'x', offendingEtm: 'E1' })
    expect(new QuotationError('x', 'failed').status).toBe(500)
  })
})
