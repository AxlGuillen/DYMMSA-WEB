import { describe, test, expect } from 'vitest'
import { officeWeekPay, parseRate } from '@/lib/office-pay'

describe('officeWeekPay', () => {
  test('tiempo completo: horas trabajadas + 8 h del sábado, todo a tarifa simple', () => {
    // 34:46 h + 8 h del sábado = 42.7667 h × $52; the amount uses exact minutes, not the rounded hours.
    expect(officeWeekPay({ minutes: 34 * 60 + 46 }, 'full_time', 52)).toEqual({
      rate: 52, workedMinutes: 2086, saturdayHours: 8, paidHours: 42.77, amount: 2223.87,
    })
  })

  test('las horas extra no tienen recargo: 45 h trabajadas pagan lo mismo por hora', () => {
    expect(officeWeekPay({ minutes: 45 * 60 }, 'full_time', 52)?.amount).toBe((45 + 8) * 52)
  })

  test('medio tiempo: el sábado vale 4 h', () => {
    expect(officeWeekPay({ minutes: 20 * 60 }, 'part_time', 52)).toMatchObject({ saturdayHours: 4, amount: 24 * 52 })
  })

  test('sin jornada no se suma sábado; sin tarifa no hay estimado', () => {
    expect(officeWeekPay({ minutes: 600 }, null, 52)).toMatchObject({ saturdayHours: 0, amount: 520 })
    expect(officeWeekPay({ minutes: 600 }, 'full_time', null)).toBeNull()
    expect(officeWeekPay({ minutes: 600 }, 'full_time', 0)).toBeNull()
  })
})

describe('parseRate', () => {
  test('acepta número o texto positivo; vacío, cero o basura → null', () => {
    expect(parseRate('52.00')).toBe(52)
    expect(parseRate(60.555)).toBe(60.56)
    expect(parseRate('')).toBeNull()
    expect(parseRate(0)).toBeNull()
    expect(parseRate('abc')).toBeNull()
    expect(parseRate(null)).toBeNull()
  })
})
