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
  officeSaturdayMinutes,
  payrollArea,
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
  test('entre semana: normal hasta la jornada, el resto extra, ambas ×1 (igual en oficina y taller)', () => {
    expect(classifyDay('2026-09-21', 690, 'full_time', 'workshop')).toEqual({ regular: 480, extra: 210, saturdayExtra: 0, sunday: 0, equivalent: 690 })
    expect(classifyDay('2026-09-21', 300, 'full_time', 'office')).toMatchObject({ regular: 300, extra: 0, equivalent: 300 })
    expect(classifyDay('2026-09-21', 300, 'part_time', 'workshop')).toMatchObject({ regular: 240, extra: 60, equivalent: 300 })
  })

  test('REGLA #135: el sábado del taller paga normales las primeras 5 h y solo el resto al doble, sin importar la jornada', () => {
    expect(classifyDay('2026-09-19', 300, 'full_time', 'workshop')).toEqual({ regular: 300, extra: 0, saturdayExtra: 0, sunday: 0, equivalent: 300 })
    // 7 h → 5 + 2×2 = 9 equivalentes.
    expect(classifyDay('2026-09-19', 420, 'full_time', 'workshop')).toEqual({ regular: 300, extra: 0, saturdayExtra: 120, sunday: 0, equivalent: 540 })
    expect(classifyDay('2026-09-19', 420, 'part_time', 'workshop')).toEqual(classifyDay('2026-09-19', 420, 'full_time', 'workshop'))
    expect(classifyDay('2026-09-19', 180, 'full_time', 'workshop')).toMatchObject({ regular: 180, saturdayExtra: 0, equivalent: 180 })
  })

  test('REGLA #135: el sábado de la oficina se paga todo normal, sin recargo', () => {
    expect(classifyDay('2026-09-19', 480, 'full_time', 'office')).toEqual({ regular: 480, extra: 0, saturdayExtra: 0, sunday: 0, equivalent: 480 })
    expect(classifyDay('2026-09-19', 600, 'full_time', 'office')).toMatchObject({ regular: 600, saturdayExtra: 0, equivalent: 600 })
  })

  test('el domingo sigue triple sobre TODAS las horas, en oficina y taller', () => {
    expect(classifyDay('2026-09-20', 240, 'full_time', 'workshop')).toEqual({ regular: 0, extra: 0, saturdayExtra: 0, sunday: 240, equivalent: 720 })
    expect(classifyDay('2026-09-20', 240, 'full_time', 'office')).toMatchObject({ sunday: 240, equivalent: 720 })
  })

  test('sábado de oficina regalado = horas diarias de su jornada; oficina = perfil ligado con área oficina', () => {
    expect(officeSaturdayMinutes('full_time')).toBe(480)
    expect(officeSaturdayMinutes('part_time')).toBe(240)
    const areas = new Map([['p-office', 'office' as const], ['p-shop', 'workshop' as const]])
    expect(payrollArea({ profile_id: 'p-office' }, areas)).toBe('office')
    expect(payrollArea({ profile_id: 'p-shop' }, areas)).toBe('workshop')
    // No account, or a profile the caller cannot read: the workshop.
    expect(payrollArea({ profile_id: null }, areas)).toBe('workshop')
    expect(payrollArea({ profile_id: 'p-unknown' }, areas)).toBe('workshop')
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
    // Saturday 6 h in the workshop: 5 normal + 1 at double (#135).
    expect(a.totals).toEqual({ regular: 480 + 300, extra: 210, saturdayExtra: 60, sunday: 0, equivalent: 480 + 300 + 210 + 120 })
    expect(a.area).toBe('workshop')
    expect(a.drafts).toBe(1)
    expect(a.days[3]?.status).toBe('draft')
    expect(a.days[1]).toBeNull()
    expect(b.totals).toMatchObject({ sunday: 120, equivalent: 360 })
    expect(b.missedMinutes).toBe(60)
    expect(view.totals.equivalent).toBe(a.totals.equivalent + 360)
  })

  test('el área sale del perfil ligado: el sábado de la oficina no lleva doble', () => {
    const office = employee('ofi', { profile_id: 'p-ofi' })
    const view = buildPayrollView('2026-09-19', [office], [day('ofi', '2026-09-19', 480)], null, new Map([['p-ofi', 'office']]))
    expect(view.rows[0]).toMatchObject({ area: 'office', totals: { regular: 480, saturdayExtra: 0, equivalent: 480 } })
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
