/** saveTypedDay, confirmDrafts(ids) and loadPayrollInputs (#155 D): shared by the payroll routes and the MCP. */

import { describe, test, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { confirmDrafts, loadPayrollInputs, PayrollError, saveTypedDay } from '@/lib/payroll-store'
import { createMockSupabase, filterValue } from '../helpers/supabase-mock'

const asDb = (mock: ReturnType<typeof createMockSupabase>) => mock as unknown as SupabaseClient
const SAT = '2026-09-19'
const EMP = '11111111-1111-4111-8111-111111111111'

describe('saveTypedDay', () => {
  test('un día vacío (0 h, 0 no trabajadas, sin nota) borra la fila de ese empleado y fecha', async () => {
    const db = createMockSupabase()
    expect(await saveTypedDay(asDb(db), { employee_id: EMP, work_date: '2026-09-22', worked_minutes: 0, missed_minutes: 0, note: '  ' })).toEqual({ saved: 0, skipped: [], deleted: true })
    const call = db.callsTo('payroll_days', 'delete')[0]
    expect(filterValue(call, 'employee_id')).toBe(EMP)
    expect(filterValue(call, 'work_date')).toBe('2026-09-22')
    expect(db.callsTo('payroll_days', 'upsert')).toEqual([])
  })

  test('con horas pisa lo que haya y queda manual y confirmado', async () => {
    const db = createMockSupabase({
      responses: {
        'payroll_days.select': { data: [{ employee_id: EMP, work_date: '2026-09-22', status: 'draft', source: 'sheet', missed_minutes: 0, note: null }], error: null },
        'payroll_periods.select': { data: [], error: null },
      },
    })
    const result = await saveTypedDay(asDb(db), { employee_id: EMP, work_date: '2026-09-22', worked_minutes: 570, missed_minutes: 0, note: null })
    expect(result).toEqual({ saved: 1, skipped: [], deleted: false })
    expect(db.upsertPayload('payroll_days')).toEqual([
      { employee_id: EMP, work_date: '2026-09-22', worked_minutes: 570, missed_minutes: 0, note: null, source: 'manual', status: 'confirmed' },
    ])
  })

  test('un corte cerrado es PayrollError; un fallo al borrar es 500 con el mensaje de siempre', async () => {
    const closed = createMockSupabase({ responses: { 'payroll_days.select': { data: [], error: null }, 'payroll_periods.select': { data: [{ start_date: SAT }], error: null } } })
    await expect(saveTypedDay(asDb(closed), { employee_id: EMP, work_date: '2026-09-22', worked_minutes: 60 })).rejects.toBeInstanceOf(PayrollError)
    const broken = createMockSupabase({ responses: { 'payroll_days.delete': { data: null, error: { message: 'boom' } } } })
    await expect(saveTypedDay(asDb(broken), { employee_id: EMP, work_date: '2026-09-22', worked_minutes: 0 })).rejects.toMatchObject({ status: 500, message: 'Error al borrar el día' })
    const trigger = createMockSupabase({ responses: { 'payroll_days.delete': { data: null, error: { code: '23514', message: 'El corte está cerrado' } } } })
    await expect(saveTypedDay(asDb(trigger), { employee_id: EMP, work_date: '2026-09-22', worked_minutes: 0 })).rejects.toMatchObject({ status: 400 })
  })
})

describe('confirmDrafts', () => {
  test('sin ids confirma todos los borradores del corte; con ids, solo esos', async () => {
    const db = createMockSupabase({ responses: { 'payroll_days.update': { data: [{ id: 'a' }, { id: 'b' }], error: null } } })
    expect(await confirmDrafts(asDb(db), SAT)).toBe(2)
    expect(db.callsTo('payroll_days', 'update')[0].filters.some((f) => f.method === 'in')).toBe(false)
    expect(await confirmDrafts(asDb(db), SAT, ['a', 'b'])).toBe(2)
    expect(db.callsTo('payroll_days', 'update')[1].filters.find((f) => f.method === 'in')?.args).toEqual(['id', ['a', 'b']])
  })

  test('una lista de ids vacía no escribe nada', async () => {
    const db = createMockSupabase()
    expect(await confirmDrafts(asDb(db), SAT, [])).toBe(0)
    expect(db.callsTo('payroll_days')).toEqual([])
  })
})

describe('loadPayrollInputs', () => {
  test('lee empleados, días, corte y áreas del corte que empieza en sábado; otro inicio es 400', async () => {
    const db = createMockSupabase({
      responses: {
        'payroll_employees.select': { data: [{ id: EMP }], error: null },
        'payroll_days.select': { data: [], error: null },
        'payroll_periods.select': { data: null, error: null },
        'profiles.select': { data: [{ id: 'p1', area: 'office' }], error: null },
      },
    })
    const inputs = await loadPayrollInputs(asDb(db), SAT)
    expect(inputs.employees).toHaveLength(1)
    expect(inputs.period).toBeNull()
    expect(inputs.areas.get('p1')).toBe('office')
    await expect(loadPayrollInputs(asDb(db), '2026-09-22')).rejects.toBeInstanceOf(PayrollError)
  })
})
