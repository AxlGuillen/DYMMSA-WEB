import { describe, test, expect } from 'vitest'
import { explainPgError } from '@/lib/supabase-errors'

const checkErr = (constraint: string, code = '23514') => ({
  code,
  message: `new row for relation "tbl" violates check constraint "${constraint}"`,
})

describe('explainPgError', () => {
  test('error null/undefined → mensaje desconocido', () => {
    expect(explainPgError(null).userMessage).toMatch(/desconocido/i)
    expect(explainPgError(undefined).isConstraintViolation).toBe(false)
  })

  // ── 23514 CHECK ─────────────────────────────────────────────────

  test('quotation_items_quantity_check sin items → mensaje genérico', () => {
    const r = explainPgError(checkErr('quotation_items_quantity_check'))
    expect(r.isConstraintViolation).toBe(true)
    expect(r.userMessage).toMatch(/cantidad 0/i)
    expect(r.offendingEtm).toBeUndefined()
    expect(r.constraintName).toBe('quotation_items_quantity_check')
  })

  test('quotation_items_quantity_check con items → identifica el ETM con quantity = 0', () => {
    const items = [
      { etm: 'OK-1', quantity: 5, unit_price: 100 },
      { etm: 'BAD-1', quantity: 0, unit_price: 50 }, // ofensor
      { etm: 'OK-2', quantity: 3, unit_price: 200 },
    ]
    const r = explainPgError(checkErr('quotation_items_quantity_check'), items)
    expect(r.offendingEtm).toBe('BAD-1')
    expect(r.userMessage).toContain('"BAD-1"')
  })

  test('quotation_items_quantity_check identifica quantity null como ofensor', () => {
    const items = [
      { etm: 'OK-1', quantity: 5 },
      { etm: 'BAD-1', quantity: null },
    ]
    expect(explainPgError(checkErr('quotation_items_quantity_check'), items).offendingEtm)
      .toBe('BAD-1')
  })

  test('quotation_items_price_check identifica precio negativo', () => {
    const items = [
      { etm: 'OK-1', unit_price: 100 },
      { etm: 'NEG-1', unit_price: -10 },
    ]
    const r = explainPgError(checkErr('quotation_items_price_check'), items)
    expect(r.offendingEtm).toBe('NEG-1')
    expect(r.userMessage).toMatch(/precio negativo/i)
  })

  test('order_items_quantity_approved_check identifica producto con cantidad aprobada 0', () => {
    const items = [
      { etm: 'OK-1', quantity_approved: 3 },
      { etm: 'BAD-1', quantity_approved: 0 },
    ]
    const r = explainPgError(checkErr('order_items_quantity_approved_check'), items)
    expect(r.offendingEtm).toBe('BAD-1')
    expect(r.userMessage).toMatch(/orden/i)
  })

  test('order_items_unit_price_check con items → identifica el ETM con precio negativo', () => {
    const items = [{ etm: 'BAD', unit_price: -1 }]
    const r = explainPgError(checkErr('order_items_unit_price_check'), items)
    expect(r.offendingEtm).toBe('BAD')
  })

  test('check_quantity_sum → mensaje de invariante', () => {
    const r = explainPgError(checkErr('check_quantity_sum'))
    expect(r.userMessage).toMatch(/no cuadran/i)
    expect(r.isConstraintViolation).toBe(true)
  })

  test('store_inventory_quantity_check → mensaje de race / recargar', () => {
    const r = explainPgError(checkErr('store_inventory_quantity_check'))
    expect(r.userMessage).toMatch(/stock cambió/i)
  })

  test('quotations_total_check → total negativo', () => {
    const r = explainPgError(checkErr('quotations_total_check'))
    expect(r.userMessage).toMatch(/total.*negativo/i)
  })

  test('CHECK desconocida → fallback con nombre', () => {
    const r = explainPgError(checkErr('some_future_check'))
    expect(r.userMessage).toMatch(/some_future_check/)
    expect(r.isConstraintViolation).toBe(true)
  })

  // ── 23505 UNIQUE ────────────────────────────────────────────────

  test('etm_products_etm_unique → mensaje de ETM duplicado en catálogo', () => {
    const r = explainPgError({
      code: '23505',
      message: 'duplicate key value violates unique constraint "etm_products_etm_unique"',
    })
    expect(r.userMessage).toMatch(/catálogo/i)
    expect(r.isConstraintViolation).toBe(true)
  })

  test('store_inventory_model_code_key → mensaje de modelo duplicado', () => {
    const r = explainPgError({
      code: '23505',
      message: 'duplicate key value violates unique constraint "store_inventory_model_code_key"',
    })
    expect(r.userMessage).toMatch(/modelo.*inventario/i)
  })

  // ── 23503 FK ────────────────────────────────────────────────────

  test('FK violation → mensaje genérico de relación', () => {
    const r = explainPgError({
      code: '23503',
      message: 'insert or update on table "x" violates foreign key constraint "x_fkey"',
    })
    expect(r.userMessage).toMatch(/relacionado/i)
    expect(r.isConstraintViolation).toBe(true)
  })

  // ── 23502 NOT NULL ──────────────────────────────────────────────

  test('NOT NULL violation → mensaje de campo requerido', () => {
    const r = explainPgError({
      code: '23502',
      message: 'null value in column "x" violates not-null constraint',
    })
    expect(r.userMessage).toMatch(/requerido/i)
  })

  // ── Fallback ────────────────────────────────────────────────────

  test('error sin código y sin constraint → usa el message tal cual', () => {
    const r = explainPgError({ message: 'random error from db' })
    expect(r.userMessage).toBe('random error from db')
    expect(r.isConstraintViolation).toBe(false)
  })

  test('error sin message → fallback genérico', () => {
    const r = explainPgError({ code: '99999' })
    expect(r.userMessage).toMatch(/Ocurrió un error/i)
  })
})
