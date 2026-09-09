/**
 * Clock report parser and week math (#93). The fixture mirrors the real NGTeco
 * export; the strongest check is that recomputed minutes match the totals the
 * clock printed, within the seconds the report omits.
 */

import { describe, test, expect } from 'vitest'
import {
  buildWeekView,
  cellText,
  formatDuration,
  minutesBetween,
  normalizeTime,
  parseNgtecoReport,
  shiftWeek,
  weekBounds,
} from '@/lib/timesheet'
import { NGTECO_NUMERIC, NGTECO_PERIOD, NGTECO_WEEK } from '../helpers/fixtures/ngteco'

describe('parseNgtecoReport', () => {
  const report = parseNgtecoReport(NGTECO_WEEK)

  test('lee el período y un bloque por empleado con su id de checador', () => {
    expect(report.period).toEqual(NGTECO_PERIOD)
    expect(report.employees.map((e) => [e.clockId, e.name])).toEqual([
      [1, 'Diego Baltazar'],
      [5, 'Tania'],
    ])
    expect(report.warnings).toEqual([])
  })

  test('la fila de continuación hereda la fecha y los días vacíos no producen checadas', () => {
    const diego = report.employees[0]
    expect(diego.punches).toEqual([
      { date: '2026-08-31', clockIn: '10:06', clockOut: '18:27', note: null },
      { date: '2026-09-01', clockIn: '08:55', clockOut: '19:20', note: null },
      { date: '2026-09-01', clockIn: '19:21', clockOut: '19:21', note: null },
      { date: '2026-09-03', clockIn: '09:02', clockOut: null, note: 'olvidó checar salida' },
    ])
  })

  test('los minutos recalculados cuadran con las "Horas totales" del checador (± seconds)', () => {
    // The clock counts seconds but prints HH:MM, so its totals can differ by up
    // to a minute per punch from HH:MM math (the real report shows 10:24 and 10:25
    // for the same shift). Anything beyond that would be a parser bug.
    for (const employee of report.employees) {
      const minutes = employee.punches.reduce((sum, p) => sum + (minutesBetween(p.clockIn, p.clockOut) ?? 0), 0)
      const [h, m] = (employee.reportedTotal ?? '0:0').split(':').map(Number)
      expect(Math.abs(minutes - (h * 60 + m))).toBeLessThanOrEqual(employee.punches.length)
    }
    expect(formatDuration(1126)).toBe('18:46')
  })

  test('acepta celdas tipadas por Excel (serial de fecha, fracción de día) y el nombre en una línea', () => {
    const numeric = parseNgtecoReport(NGTECO_NUMERIC)
    expect(numeric.employees[0].clockId).toBe(1)
    expect(numeric.employees[0].punches).toEqual([
      { date: '2026-08-31', clockIn: '10:06', clockOut: '18:27', note: null },
    ])
  })

  test('avisa y sigue: empleado sin id, salida sin entrada, fecha fuera del período', () => {
    const odd = parseNgtecoReport([
      ['Período de pago', '', '', '2026-08-31-2026-09-06'],
      ['Empleado', '', '', 'Sin Id'],
      ['LU', '2026-08-31', '', '18:00'],
      ['M', '2026-09-08', '09:00', '17:00'],
    ])
    expect(odd.employees[0].clockId).toBeNull()
    expect(odd.employees[0].punches).toHaveLength(1)
    expect(odd.warnings).toEqual([
      'Empleado sin id de checador: "Sin Id"',
      'Salida sin entrada: Sin Id 2026-08-31 18:00',
      'Fecha fuera del período: Sin Id 2026-09-08',
    ])
  })

  test('una checada antes de cualquier bloque de empleado se reporta y se descarta', () => {
    const orphan = parseNgtecoReport([['LU', '2026-08-31', '10:00', '18:00']])
    expect(orphan.employees).toEqual([])
    expect(orphan.warnings[0]).toMatch(/fuera de un bloque/)
  })
})

describe('cellText / normalizeTime', () => {
  test('fracción de día → hora, serial → fecha, texto → recortado', () => {
    expect(cellText(606 / 1440)).toBe('10:06')
    expect(cellText(46265)).toBe('2026-08-31')
    expect(cellText('  10:06 ')).toBe('10:06')
    expect(cellText(null)).toBe('')
  })

  test('normaliza H:M y HH:MM:SS; rechaza lo que no es hora', () => {
    expect(normalizeTime('9:5')).toBe('09:05')
    expect(normalizeTime('10:06:00')).toBe('10:06')
    expect(normalizeTime('25:00')).toBeNull()
    expect(normalizeTime('mañana')).toBeNull()
  })
})

describe('duraciones', () => {
  test('se acumulan como duración: más de 24 h se lee 37:54, no como hora del día', () => {
    expect(formatDuration(37 * 60 + 54)).toBe('37:54')
    expect(formatDuration(0)).toBe('00:00')
    expect(formatDuration(501)).toBe('08:21')
  })

  test('sin salida no hay minutos; una salida anterior a la entrada cuenta 0', () => {
    expect(minutesBetween('10:06', null)).toBeNull()
    expect(minutesBetween('18:00', '09:00')).toBe(0)
  })
})

describe('semanas', () => {
  test('la semana va de lunes a domingo, como el "Período de pago" del checador', () => {
    expect(weekBounds('2026-09-03')).toEqual(NGTECO_PERIOD)
    expect(weekBounds('2026-08-31')).toEqual(NGTECO_PERIOD)
    expect(weekBounds('2026-09-06')).toEqual(NGTECO_PERIOD)
    expect(shiftWeek('2026-08-31', 1)).toBe('2026-09-07')
    expect(shiftWeek('2026-08-31', -1)).toBe('2026-08-24')
  })

  test('buildWeekView arma los 7 días, suma por día y cuenta las checadas abiertas', () => {
    const view = buildWeekView(
      [
        { work_date: '2026-09-01', clock_in: '19:21', clock_out: '19:21' },
        { work_date: '2026-09-01', clock_in: '08:55', clock_out: '19:20' },
        { work_date: '2026-08-31', clock_in: '10:06', clock_out: '18:27' },
        { work_date: '2026-09-03', clock_in: '09:02', clock_out: null },
        { work_date: '2026-09-10', clock_in: '09:00', clock_out: '10:00' },
      ],
      '2026-08-31',
    )
    expect(view.days.map((d) => d.label)).toEqual(['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'])
    expect(view.days[0].minutes).toBe(501)
    // Ordered by clock-in inside the day, second pair adds 0 minutes.
    expect(view.days[1].punches.map((p) => p.entry.clock_in)).toEqual(['08:55', '19:21'])
    expect(view.days[1].minutes).toBe(625)
    expect(view.days[3].open).toBe(1)
    expect(view.days[6].punches).toEqual([])
    // The entry from the next week is ignored, not misplaced.
    expect(view.minutes).toBe(1126)
    expect(view.open).toBe(1)
    expect(view.end).toBe('2026-09-06')
  })
})
