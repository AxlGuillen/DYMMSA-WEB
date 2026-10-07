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
  reportMismatches,
  shiftWeek,
  weekBounds,
  weekChartData, shiftProgress, buildWeeklyTrend, SHIFT_HOURS, isRealDate, excusedWeekdays,
  dayStatus, excusesFor, parseExcusedDay, weekTargetMinutes,
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
      { date: '2026-08-31', clockIn: '10:06', clockOut: '18:27', note: null, reported: '08:21' },
      { date: '2026-09-01', clockIn: '08:55', clockOut: '19:20', note: null, reported: '10:24' },
      { date: '2026-09-01', clockIn: '19:21', clockOut: '19:21', note: null, reported: '00:00' },
      { date: '2026-09-03', clockIn: '09:02', clockOut: null, note: 'olvidó checar salida', reported: null },
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
      { date: '2026-08-31', clockIn: '10:06', clockOut: '18:27', note: null, reported: null },
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

    const badIn = parseNgtecoReport([
      ['Período de pago', '', '', '2026-08-31-2026-09-06'],
      ['Empleado', '', '', 'Tania\n(5)'],
      ['Fecha', '', 'ENTRADA', 'SALIDA', 'Tiempo de trabajo', 'Total diario', 'Nota'],
      ['LU', '2026-08-31', '9:00 AM', '18:00', '', '', ''],
    ])
    expect(badIn.warnings).toEqual([expect.stringMatching(/^Hora de entrada inválida: Tania 2026-08-31/)])
    expect(badIn.employees[0].punches).toEqual([])
  })
})

describe('reportMismatches: lo transcrito debe cuadrar con los totales del checador (#132)', () => {
  const withRow = (index: number, row: string[]) => NGTECO_WEEK.map((r, i) => (i === index ? row : r))
  const diegoMonday = NGTECO_WEEK.findIndex((r) => r[1] === '2026-08-31')

  test('el reporte tal cual cuadra, aunque el checador difiera un minuto por segundos', () => {
    expect(reportMismatches(parseNgtecoReport(NGTECO_WEEK))).toEqual([])
  })

  test('una hora mal copiada no cuadra con su "Tiempo de trabajo" ni con el total', () => {
    const typo = parseNgtecoReport(withRow(diegoMonday, ['LU', '2026-08-31', '10:06', '18:47', '08:21', '08:21', '', '']))
    expect(reportMismatches(typo)).toEqual([
      'Diego Baltazar 2026-08-31 10:06–18:47: el reporte dice 08:21 de trabajo',
      'Diego Baltazar: las checadas suman 19:06 y el reporte dice 18:46',
    ])
  })

  test('una fila que se quedó fuera se nota en el total del bloque', () => {
    const dropped = parseNgtecoReport(NGTECO_WEEK.filter((_, i) => i !== diegoMonday))
    expect(reportMismatches(dropped)).toEqual(['Diego Baltazar: las checadas suman 10:25 y el reporte dice 18:46'])
  })

  test('un bloque con checadas y sin su fila "Horas totales" no se acepta', () => {
    const noTotal = parseNgtecoReport(NGTECO_WEEK.filter((r) => !(r[0] === 'Horas totales' && r[5] === '16:46')))
    expect(reportMismatches(noTotal)).toEqual(['Tania: falta su fila "Horas totales"'])
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

describe('referencias de jornada (#101)', () => {
  const entry = (date: string, clockIn: string, clockOut: string | null) => ({ work_date: date, clock_in: clockIn, clock_out: clockOut })

  test('weekChartData: horas con un decimal por día y las checadas abiertas aparte', () => {
    const week = buildWeekView([entry('2026-08-31', '09:00', '17:30'), entry('2026-09-01', '09:00', null)], '2026-08-31')
    const data = weekChartData(week)
    expect(data).toHaveLength(7)
    expect(data[0]).toMatchObject({ label: 'Lun', date: '2026-08-31', hours: 8.5, minutes: 510, open: 0 })
    expect(data[1]).toMatchObject({ label: 'Mar', date: '2026-09-01', hours: 0, minutes: 0, open: 1 })
  })

  test('weekChartData: los minutos exactos viajan aparte del redondeo de la barra', () => {
    const [day] = weekChartData(buildWeekView([entry('2026-08-31', '09:00', '17:29')], '2026-08-31'))
    expect(day).toMatchObject({ hours: 8.5, minutes: 509 })
  })

  test('shiftProgress: objetivo semanal 40 h / 20 h, porcentaje y faltante; null sin jornada', () => {
    expect(shiftProgress(30 * 60, 'full_time')).toEqual({ target: 2400, pct: 75, missing: 600 })
    expect(shiftProgress(21 * 60, 'part_time')).toEqual({ target: 1200, pct: 105, missing: 0 })
    expect(shiftProgress(10, null)).toBeNull()
    expect(SHIFT_HOURS.full_time).toEqual({ daily: 8, weekly: 40 })
    expect(SHIFT_HOURS.part_time).toEqual({ daily: 4, weekly: 20 })
  })

  test('buildWeeklyTrend: N semanas terminando en la dada, de la más vieja a la más nueva; vacías en 0', () => {
    const trend = buildWeeklyTrend(
      [entry('2026-08-31', '09:00', '17:00'), entry('2026-08-17', '09:00', '13:00'), entry('2026-08-18', '08:00', null)],
      '2026-08-31',
      3,
    )
    expect(trend.map((w) => w.start)).toEqual(['2026-08-17', '2026-08-24', '2026-08-31'])
    expect(trend.map((w) => w.hours)).toEqual([4, 0, 8])
    expect(trend[0].open).toBe(1)
    expect(trend[2].end).toBe('2026-09-06')
    // Without a shift there is no target to discount.
    expect(trend[2]).toMatchObject({ target: null, excused: 0 })
  })

  test('buildWeeklyTrend descuenta los días justificados del objetivo de SU semana, igual que Mi semana', () => {
    const excuses = new Map([['2026-08-26', 'holiday'], ['2026-08-29', 'holiday']] as const)
    const trend = buildWeeklyTrend([entry('2026-08-24', '09:00', '17:00')], '2026-08-31', 2, { shift: 'full_time', excuses })
    // Wednesday discounts 8 h; the marked Saturday never asked for hours.
    expect(trend[0]).toMatchObject({ start: '2026-08-24', target: 32 * 60, excused: 1 })
    expect(trend[1]).toMatchObject({ start: '2026-08-31', target: 40 * 60, excused: 0 })
    const week = buildWeekView([], '2026-08-24')
    expect(excusedWeekdays(week, excuses)).toBe(1)
  })

  test('isRealDate exige que la fecha exista, no solo su forma', () => {
    expect(isRealDate('2026-02-28')).toBe(true)
    expect(isRealDate('2028-02-29')).toBe(true)
    expect(isRealDate('2026-02-30')).toBe(false)
    expect(isRealDate('2026-13-01')).toBe(false)
    expect(isRealDate('2026-9-1')).toBe(false)
    expect(isRealDate(null)).toBe(false)
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

describe('días cumplidos y días justificados (meeting 2026-10-01)', () => {
  const entry = (date: string, clockIn: string, clockOut: string | null) => ({ work_date: date, clock_in: clockIn, clock_out: clockOut })
  // Week of Mon 2026-09-21: Mon 8 h, Tue 5 h, Wed nothing (holiday), Thu 3 h (early exit), Fri open.
  const week = buildWeekView(
    [
      entry('2026-09-21', '09:00', '17:00'),
      entry('2026-09-22', '09:00', '14:00'),
      entry('2026-09-24', '09:00', '12:00'),
      entry('2026-09-25', '09:00', null),
    ],
    '2026-09-21',
  )
  const excuses = new Map([['2026-09-23', 'holiday'], ['2026-09-24', 'early_release']] as const)

  test('verde si cumplió su jornada, rojo si no, justificado aparte; fin de semana y sin jornada neutros', () => {
    const data = weekChartData(week, 'full_time', excuses, '2026-09-28')
    expect(data.map((d) => d.status)).toEqual(['met', 'short', 'excused', 'excused', 'open', 'off', 'off'])
    expect(data[1].missing).toBe(180)
    expect(data[2].excuse).toBe('holiday')
    expect(weekChartData(week, null, excuses, '2026-09-28').every((d) => d.status === 'off')).toBe(true)
  })

  test('medio tiempo: 4 h ya cumplen el día', () => {
    expect(weekChartData(week, 'part_time', new Map(), '2026-09-28')[1].status).toBe('met')
  })

  test('hoy no se pinta en rojo mientras el día sigue; el futuro tampoco', () => {
    const day = { date: '2026-09-22', minutes: 120, open: 0 }
    expect(dayStatus(1, day, 'full_time', undefined, '2026-09-22')).toBe('pending')
    expect(dayStatus(1, day, 'full_time', undefined, '2026-09-21')).toBe('pending')
    expect(dayStatus(1, { ...day, minutes: 480 }, 'full_time', undefined, '2026-09-22')).toBe('met')
  })

  test('el objetivo semanal descuenta el feriado completo y la salida autorizada hasta lo trabajado', () => {
    // 40 h − Wed (8 h holiday) − Thu (8 h asked, 3 h worked → asks 3 h) = 27 h.
    expect(weekTargetMinutes(week, 'full_time', excuses)).toBe(27 * 60)
    expect(weekTargetMinutes(week, 'full_time', new Map())).toBe(40 * 60)
    expect(weekTargetMinutes(week, null, excuses)).toBeNull()
    expect(shiftProgress(16 * 60, 'full_time', 27 * 60)).toEqual({ target: 1620, pct: 59, missing: 660 })
    expect(shiftProgress(0, 'full_time', 0)).toEqual({ target: 0, pct: 100, missing: 0 })
  })

  test('el día propio gana al del equipo', () => {
    const map = excusesFor(
      [
        { work_date: '2026-09-23', user_id: null, kind: 'holiday' },
        { work_date: '2026-09-23', user_id: 'u1', kind: 'early_release' },
        { work_date: '2026-09-24', user_id: 'u2', kind: 'holiday' },
      ],
      'u1',
    )
    expect([...map]).toEqual([['2026-09-23', 'early_release']])
  })

  test('parseExcusedDay valida fecha, tipo y nota; persona vacía = todo el equipo', () => {
    expect(parseExcusedDay({ work_date: '2026-09-16', kind: 'holiday', note: '  Independencia ' })).toEqual({
      value: { work_date: '2026-09-16', kind: 'holiday', user_id: null, note: 'Independencia' },
    })
    expect(parseExcusedDay({ work_date: '16/09/2026', kind: 'holiday' })).toEqual({ error: 'Fecha inválida' })
    expect(parseExcusedDay({ work_date: '2026-09-16', kind: 'vacaciones' })).toHaveProperty('error')
    expect(parseExcusedDay({ work_date: '2026-09-16', kind: 'holiday', note: 'x'.repeat(201) })).toHaveProperty('error')
  })
})
