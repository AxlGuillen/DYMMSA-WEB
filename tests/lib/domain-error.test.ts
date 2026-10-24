/** DomainError (#155 C1, #157): one base for the store errors, one mapping to HTTP in apiError(). */

import { describe, test, expect, vi, afterEach } from 'vitest'
import { DomainError, type DomainErrorKind } from '@/lib/domain-error'
import { apiError } from '@/lib/api-helpers'
import { SupplierError } from '@/lib/suppliers-store'
import { PayrollError } from '@/lib/payroll-store'
import { TimeEntryError } from '@/lib/time-entries-store'

afterEach(() => vi.restoreAllMocks())

describe('DomainError', () => {
  test.each([
    ['invalid', 400],
    ['not_found', 404],
    ['forbidden', 403],
    ['conflict', 409],
    ['failed', 500],
  ] as [DomainErrorKind, number][])('%s → %i con su mensaje en el cuerpo', (kind, status) => {
    const error = new DomainError('Algo pasó', kind)
    expect(error.status).toBe(status)
    expect(error.body).toEqual({ message: 'Algo pasó' })
  })

  test('sin kind es una regla rota (400)', () => {
    expect(new DomainError('x').kind).toBe('invalid')
  })

  test('los errores de los stores lo extienden sin cambiar su uso', () => {
    const supplier = new SupplierError('Proveedor no encontrado', 'not_found')
    expect(supplier).toBeInstanceOf(DomainError)
    expect(supplier).toMatchObject({ name: 'SupplierError', kind: 'not_found', status: 404 })
    expect(new PayrollError('Corte cerrado')).toMatchObject({ name: 'PayrollError', kind: 'invalid', status: 400 })
    expect(new TimeEntryError('Solo un administrador', 'forbidden')).toMatchObject({ name: 'TimeEntryError', status: 403 })
  })
})

describe('apiError', () => {
  test.each([
    [new SupplierError('Ya existe un proveedor con ese nombre'), 400],
    [new SupplierError('Proveedor no encontrado', 'not_found'), 404],
    [new SupplierError('Error al crear el proveedor', 'failed'), 500],
    [new TimeEntryError('Solo un administrador puede registrar checadas', 'forbidden'), 403],
    [new DomainError('La versión cambió', 'conflict'), 409],
    [new PayrollError('Hay 2 días en borrador'), 400],
  ])('%s → %i con el mensaje del store', async (error, status) => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const res = apiError(error, 'Error genérico')
    expect(res.status).toBe(status)
    expect(await res.json()).toEqual({ message: error.message })
    // The store already logged a real failure; a broken rule is not an incident.
    expect(log).not.toHaveBeenCalled()
  })

  test('cualquier otro error es un 500 genérico y queda en el log con su etiqueta', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const boom = new Error('connection reset')
    const res = apiError(boom, 'Error al crear el proveedor', 'Supplier create error:')
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ message: 'Error al crear el proveedor' })
    expect(log).toHaveBeenCalledWith('Supplier create error:', boom)
  })
})
