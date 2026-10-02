/** Payroll hour rules (#123): the Saturday→Friday cut and how each day counts. */

import { describe, test, expect } from 'vitest'
import {
  buildPayrollView,
  classifyDay,
  isIsoDate,
  isPeriodStart,
  minutesByDate,
  parseEmployeeInput,
  parseHoursInput,
  payrollPeriod,
  periodDates,
  shiftPeriod,
} from '@/lib/payroll'
import type { PayrollDay, PayrollEmployee } from '@/types/database'

const employee = (id: string, over: Partial<PayrollEmployee> = {}): PayrollEmployee => ({
  id, name: id, profile_id: null, shift: 'full_time', active: true, created_at: '', updated_at: '', ...over,
})

const day = (employeeId: string, date: string, minutes: number, over: Partial<PayrollDay> = {}): PayrollDay => ({
  id: `${employeeId}-${date}`, employee_id: employeeId, work_date: date, worked_minutes: minutes, missed_minutes: 0,
  note: null, source: 'manual', status: 'confirmed', created_at: '', updated_at: '', ...over,
})

describe('corte sábado → viernes', () => {
  test('el viernes 25/09 paga del sábado 19 al viernes 25', () => {
    expect(payrollPeriod('2026-09-25')).toEqual({ start: '2026-09-19', end: '2026-09-25' })
    expect(payrollPeriod('2026-09-19')).toEqual({ start: '2026-09-19', end: '2026-09-25' })
    expect(payrollPeriod('2026-09-20').start).toBe('2026-09-19')
    expect(payrollPeriod('2026-09-21').start).toBe('2026-09-19')
  })

  test('una hoja lunes→domingo cae en dos cortes: su fin de semana va al siguiente', () => {
    expect(payrollPeriod('2026-09-25').start).toBe('2026-09-19')
    expect(payrollPeriod('2026-09-26').start).toBe('2026-09-26')
    expect(payrollPeriod('2026-09-27').start).toBe('2026-09-26')
  })

  test('periodDates, shiftPeriod e isPeriodStart; cruza el fin de mes sin perder días', () => {
    expect(periodDates('2026-09-26')).toEqual([
      '2026-09-26', '2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02',
    ])
    expect(shiftPeriod('2026-09-19', 1)).toBe('2026-09-26')
    expect(shiftPeriod('2026-09-19', -1)).toBe('2026-09-12')
    expect(isPeriodStart('2026-09-19')).toBe(true)
    expect(isPeriodStart('2026-09-20')).toBe(false)
  })

  test('isIsoDate rechaza lo que no es fecha', () => {
    expect(isIsoDate('2026-09-19')).toBe(true)
    expect(isIsoDate('2026-13-40')).toBe(false)
    expect(isIsoDate('2026-02-30')).toBe(false)
    expect(isIsoDate('19/09/2026')).toBe(false)
    expect(isIsoDate(null)).toBe(false)
  })
})

describe('classifyDay', () => {
  test('entre semana: normal hasta la jornada, el resto extra, ambas ×1', () => {
    expect(classifyDay('2026-09-21', 690, 'full_time')).toEqual({ regular: 480, extra: 210, saturday: 0, sunday: 0, equivalent: 690 })
    expect(classifyDay('2026-09-21', 300, 'full_time')).toMatchObject({ regular: 300, extra: 0, equivalent: 300 })
    expect(classifyDay('2026-09-21', 300, 'part_time')).toMatchObject({ regular: 240, extra: 60, equivalent: 300 })
  })

  test('sábado doble y domingo triple, sobre TODAS las horas del día', () => {
    expect(classifyDay('2026-09-19', 360, 'full_time')).toEqual({ regular: 0, extra: 0, saturday: 360, sunday: 0, equivalent: 720 })
    expect(classifyDay('2026-09-20', 240, 'full_time')).toEqual({ regular: 0, extra: 0, saturday: 0, sunday: 240, equivalent: 720 })
  })
})

describe('buildPayrollView', () => {
  const ana = employee('ana')
  const beto = employee('beto', { shift: 'part_time' })

  test('totales por empleado y del corte; los borradores se ven pero no suman', () => {
    const view = buildPayrollView('2026-09-19', [ana, beto], [
      day('ana', '2026-09-19', 360),
      day('ana', '2026-09-21', 690),
      day('ana', '2026-09-22', 480, { status: 'draft', source: 'sheet' }),
      day('beto', '2026-09-20', 120, { missed_minutes: 60 }),
    ], null)

    expect(view).toMatchObject({ start: '2026-09-19', end: '2026-09-25', closed: false, drafts: 1 })
    const [a, b] = view.rows
    expect(a.totals).toEqual({ regular: 480, extra: 210, saturday: 360, sunday: 0, equivalent: 480 + 210 + 720 })
    expect(a.drafts).toBe(1)
    expect(a.days[3]?.status).toBe('draft')
    expect(a.days[1]).toBeNull()
    expect(b.totals).toMatchObject({ sunday: 120, equivalent: 360 })
    expect(b.missedMinutes).toBe(60)
    expect(view.totals.equivalent).toBe(a.totals.equivalent + 360)
  })

  test('un inactivo solo aparece donde tiene horas; el corte cerrado lo dice', () => {
    const gone = employee('gone', { active: false })
    const closed = { start_date: '2026-09-19', status: 'closed' as const, closed_at: '2026-09-25T20:00:00Z', closed_by_name: 'Axl', reopened_at: null, reopened_by_name: null }
    expect(buildPayrollView('2026-09-19', [ana, gone], [], closed)).toMatchObject({ closed: true, rows: [{ employee: { id: 'ana' } }] })
    expect(buildPayrollView('2026-09-19', [gone], [day('gone', '2026-09-22', 60)], null).rows).toHaveLength(1)
    expect(buildPayrollView('2026-09-19', [ana], [], { ...closed, status: 'open' }).closed).toBe(false)
  })
})

describe('captura', () => {
  test('parseHoursInput: decimales, reloj y coma; vacío = 0; fuera de rango o basura = null', () => {
    expect(parseHoursInput('8')).toBe(480)
    expect(parseHoursInput('11.5')).toBe(690)
    expect(parseHoursInput('8,5')).toBe(510)
    expect(parseHoursInput('8:30')).toBe(510)
    expect(parseHoursInput('  ')).toBe(0)
    expect(parseHoursInput('24')).toBe(1440)
    expect(parseHoursInput('25')).toBeNull()
    expect(parseHoursInput('8:75')).toBeNull()
    expect(parseHoursInput('ocho')).toBeNull()
    expect(parseHoursInput('-2')).toBeNull()
  })

  test('minutesByDate suma por día y cuenta aparte las checadas sin salida', () => {
    const byDate = minutesByDate([
      { work_date: '2026-09-21', clock_in: '09:00', clock_out: '13:00' },
      { work_date: '2026-09-21', clock_in: '14:00', clock_out: '18:30' },
      { work_date: '2026-09-22', clock_in: '09:00', clock_out: null },
    ])
    expect(byDate.get('2026-09-21')).toEqual({ minutes: 510, open: 0 })
    expect(byDate.get('2026-09-22')).toEqual({ minutes: 0, open: 1 })
  })

  test('parseEmployeeInput: nombre recortado y obligatorio al crear; solo devuelve lo que viene', () => {
    expect(parseEmployeeInput({ name: '  Juan   Pérez ' }, { requireName: true })).toEqual({ value: { name: 'Juan Pérez' } })
    expect(parseEmployeeInput({}, { requireName: true })).toEqual({ error: 'El nombre es obligatorio' })
    expect(parseEmployeeInput({ active: false }, { requireName: false })).toEqual({ value: { active: false } })
    expect(parseEmployeeInput({ name: 'x'.repeat(81) }, { requireName: false })).toHaveProperty('error')
    expect(parseEmployeeInput({ shift: 'nights' }, { requireName: false })).toEqual({ error: 'Jornada inválida' })
    expect(parseEmployeeInput({ profile_id: 'abc' }, { requireName: false })).toEqual({ error: 'Perfil inválido' })
    expect(parseEmployeeInput({ profile_id: null }, { requireName: false })).toEqual({ value: { profile_id: null } })
  })
})
