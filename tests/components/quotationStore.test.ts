import { describe, test, expect, beforeEach } from 'vitest'
import { useQuotationStore } from '@/stores/quotationStore'
import { resetStores } from './helpers/stores'
import type { QuotationItemRow } from '@/types/database'

function row(id: string): QuotationItemRow {
  return {
    _id: id,
    item_type: 'product',
    section_label: '',
    etm: id,
    description: '',
    description_es: '',
    dymmsa_description: '',
    model_code: '',
    brand: '',
    unit_price: 1,
    quantity: 1,
    delivery_time: 'immediate',
    _inDb: false,
    is_approved: null,
  }
}

const ids = () => useQuotationStore.getState().items.map((i) => i._id)

describe('quotationStore.moveItem', () => {
  beforeEach(() => resetStores())

  test('mueve una fila un lugar hacia arriba', () => {
    useQuotationStore.getState().setItems([row('a'), row('b'), row('c')])
    useQuotationStore.getState().moveItem('b', 'up')
    expect(ids()).toEqual(['b', 'a', 'c'])
  })

  test('mueve una fila un lugar hacia abajo', () => {
    useQuotationStore.getState().setItems([row('a'), row('b'), row('c')])
    useQuotationStore.getState().moveItem('b', 'down')
    expect(ids()).toEqual(['a', 'c', 'b'])
  })

  test('no-op al subir la primera fila', () => {
    useQuotationStore.getState().setItems([row('a'), row('b')])
    useQuotationStore.getState().moveItem('a', 'up')
    expect(ids()).toEqual(['a', 'b'])
  })

  test('no-op al bajar la última fila', () => {
    useQuotationStore.getState().setItems([row('a'), row('b')])
    useQuotationStore.getState().moveItem('b', 'down')
    expect(ids()).toEqual(['a', 'b'])
  })

  test('id inexistente → sin cambios', () => {
    useQuotationStore.getState().setItems([row('a'), row('b')])
    useQuotationStore.getState().moveItem('zzz', 'up')
    expect(ids()).toEqual(['a', 'b'])
  })

  test('intercambia con el vecino sin importar su tipo (separador en medio)', () => {
    const sep = { ...row('sep'), item_type: 'separator' as const }
    useQuotationStore.getState().setItems([row('a'), sep, row('c')])
    useQuotationStore.getState().moveItem('c', 'up')
    expect(ids()).toEqual(['a', 'c', 'sep'])
  })
})
