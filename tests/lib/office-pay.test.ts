import { describe, test, expect } from 'vitest'
import { officeWeekPay, parseRate } from '@/lib/office-pay'
import { buildWeekView } from '@/lib/timesheet'

const MON = '2026-09-28'
const entry = (date: string, clockIn: string, clockOut: string | null) => ({ work_date: date, clock_in: clockIn, clock_out: clockOut })
/** A week with the given minutes on Monday (and optionally on Saturday / Sunday). */
const week = (mondayMinutes: number, saturdayMinutes = 0, sundayMinutes = 0) =>
  buildWeekView(
    [
      entry(MON, '08:00', `${String(8 + Math.floor(mondayMinutes / 60)).padStart(2, '0')}:${String(mondayMinutes % 60).padStart(2, '0')}`),
      ...(saturdayMinutes ? [entry('2026-10-03', '08:00', `${String(8 + Math.floor(saturdayMinutes / 60)).padStart(2, '0')}:${String(saturdayMinutes % 60).padStart(2, '0')}`)] : []),
      ...(sundayMinutes ? [entry('2026-10-04', '08:00', `${String(8 + Math.floor(sundayMinutes / 60)).padStart(2, '0')}:${String(sundayMinutes % 60).padStart(2, '0')}`)] : []),
    ],
    MON,
  )

describe('officeWeekPay', () => {
  test('tiempo completo: horas trabajadas + 8 h del sábado, todo a tarifa simple', () => {
    // 8:46 h + 8 h del sábado = 16.7667 h × $52; the amount uses exact minutes, not the rounded hours.
    expect(officeWeekPay(week(8 * 60 + 46), 'full_time', 52)).toEqual({
      rate: 52, workedMinutes: 526, saturdayHours: 8, paidHours: 16.77, amount: 871.87,
    })
  })

  test('las horas extra no tienen recargo: 12 h trabajadas pagan lo mismo por hora', () => {
    expect(officeWeekPay(week(12 * 60), 'full_time', 52)?.amount).toBe((12 + 8) * 52)
  })

  test('medio tiempo: el sábado vale 4 h', () => {
    expect(officeWeekPay(week(4 * 60), 'part_time', 52)).toMatchObject({ saturdayHours: 4, amount: 8 * 52 })
  })

  test('REGLA: un sábado trabajado reemplaza al regalado, nunca se paga dos veces (review PR #137)', () => {
    // 8 h worked on Saturday with an 8 h gift: still 8, not 16.
    expect(officeWeekPay(week(8 * 60, 8 * 60), 'full_time', 52)).toMatchObject({ workedMinutes: 480, saturdayHours: 8, paidHours: 16 })
    // Worked more than the gift: the worked hours win.
    expect(officeWeekPay(week(8 * 60, 10 * 60), 'full_time', 52)).toMatchObject({ saturdayHours: 10, paidHours: 18 })
    // Part time worked 3 h on Saturday: the 4 h gift still applies.
    expect(officeWeekPay(week(4 * 60, 3 * 60), 'part_time', 52)).toMatchObject({ saturdayHours: 4, paidHours: 8 })
    // A Sunday counts as worked hours, at the same rate.
    expect(officeWeekPay(week(8 * 60, 0, 2 * 60), 'full_time', 52)).toMatchObject({ workedMinutes: 600, paidHours: 18 })
  })

  test('sin jornada el sábado solo vale lo trabajado; sin tarifa no hay estimado', () => {
    expect(officeWeekPay(week(600), null, 52)).toMatchObject({ saturdayHours: 0, amount: 520 })
    expect(officeWeekPay(week(600, 120), null, 52)).toMatchObject({ saturdayHours: 2, amount: 624 })
    expect(officeWeekPay(week(600), 'full_time', null)).toBeNull()
    expect(officeWeekPay(week(600), 'full_time', 0)).toBeNull()
  })
})

describe('parseRate', () => {
  test('acepta número o texto positivo; vacío, cero o basura → null', () => {
    expect(parseRate('52.00')).toBe(52)
    expect(parseRate(60.555)).toBe(60.56)
    expect(parseRate('')).toBeNull()
    expect(parseRate(0)).toBeNull()
    expect(parseRate(0.004)).toBeNull()
    expect(parseRate(0.005)).toBe(0.01)
    expect(parseRate('abc')).toBeNull()
    expect(parseRate(null)).toBeNull()
  })
})
