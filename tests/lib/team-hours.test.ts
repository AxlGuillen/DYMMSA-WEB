import { describe, test, expect } from 'vitest'
import { buildClockWorkshopRows, buildOfficeRows, buildWorkshopRows, teamTotals } from '@/lib/team-hours'

const MON = '2026-09-28'
const DATES = ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']
const entry = (user_id: string, work_date: string, clock_in: string, clock_out: string | null) => ({ user_id, work_date, clock_in, clock_out })

describe('buildOfficeRows', () => {
  const profiles = [
    { id: 'u-tania', display_name: 'Tania', shift: 'part_time' as const, hourly_rate: 52 },
    { id: 'u-santi', display_name: 'Santiago', shift: 'full_time' as const, hourly_rate: null },
  ]
  const entries = [
    entry('u-tania', '2026-09-28', '09:00', '13:00'),
    entry('u-tania', '2026-09-29', '09:00', '11:00'),
    entry('u-santi', '2026-09-28', '09:00', '17:00'),
  ]

  test('cada persona con sus horas por día, estado, objetivo y pago', () => {
    const [tania, santi] = buildOfficeRows(profiles, entries, [{ work_date: '2026-09-30', user_id: null, kind: 'holiday' }], MON, '2026-10-05')
    expect(tania).toMatchObject({ name: 'Tania', minutes: 360, target: 16 * 60 })
    expect(tania.days.slice(0, 3).map((d) => d.status)).toEqual(['met', 'short', 'excused'])
    // 6 h + 4 h del sábado (medio tiempo) × $52.
    expect(tania.pay?.amount).toBe(520)
    expect(santi.pay).toBeNull()
    expect(santi.days[0]).toMatchObject({ minutes: 480, status: 'met' })
  })

  test('las checadas de una persona no se mezclan con las de otra', () => {
    const [, santi] = buildOfficeRows(profiles, entries, [], MON, '2026-10-05')
    expect(santi.minutes).toBe(480)
  })
})

describe('buildWorkshopRows', () => {
  test('horas por día desde Nómina y cuántos días siguen en borrador', () => {
    const [jose] = buildWorkshopRows(
      [{ id: 'e-jose', name: 'José', shift: 'full_time' }],
      [
        { employee_id: 'e-jose', work_date: '2026-09-28', worked_minutes: 600, status: 'confirmed' },
        { employee_id: 'e-jose', work_date: '2026-10-03', worked_minutes: 300, status: 'draft' },
        { employee_id: 'e-otro', work_date: '2026-09-28', worked_minutes: 999, status: 'confirmed' },
      ],
      DATES,
    )
    expect(jose.minutes).toBe(900)
    expect(jose.drafts).toBe(1)
    expect(jose.days.map((d) => d.minutes)).toEqual([600, 0, 0, 0, 0, 300, 0])
  })
})

describe('teamTotals', () => {
  test('suma horas por grupo y el pago de la oficina', () => {
    const office = buildOfficeRows([{ id: 'u', display_name: 'U', shift: 'full_time', hourly_rate: 52 }], [entry('u', MON, '09:00', '17:00')], [], MON, '2026-10-05')
    const workshop = buildWorkshopRows([{ id: 'e', name: 'E', shift: 'full_time' }], [{ employee_id: 'e', work_date: MON, worked_minutes: 120, status: 'draft' }], DATES)
    expect(teamTotals(office, workshop)).toEqual({ officeMinutes: 480, officePay: (8 + 8) * 52, workshopMinutes: 120 })
  })
})

describe('buildClockWorkshopRows', () => {
  test('alguien del taller con cuenta: horas del checador, sin pago ni borradores', () => {
    const [row] = buildClockWorkshopRows([{ id: 'u-t', display_name: 'Taller Uno', shift: 'full_time' }], [entry('u-t', MON, '08:00', '18:00')], MON)
    expect(row).toMatchObject({ source: 'clock', minutes: 600, drafts: 0 })
    expect(row).not.toHaveProperty('pay')
  })
})
