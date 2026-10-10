/** Admin team overview (2026-10-05): the office from the clock (Horas), the workshop from Nómina. Pure; clock injected. */

import { officeWeekPay, type WeekPay } from './office-pay'
import { monthOf, shiftDays } from './month'
import {
  buildWeekView,
  excusesFor,
  minutesBetween,
  weekChartData,
  weekTargetMinutes,
  type DayStatus,
  type ISODate,
} from './timesheet'
import type { ExcusedDay, PayrollDay, PayrollEmployee, Profile, ProfileArea, ProfileShift } from '@/types/database'

type EntryLike = { user_id: string; work_date: string; clock_in: string; clock_out: string | null }
/** The rate comes flattened from `profile_pay` (admin-only); absent = no estimate. */
type OfficeProfile = Pick<Profile, 'id' | 'display_name' | 'shift'> & { avatar_url?: string | null; hourly_rate?: number | null }

export interface OfficeRow {
  id: string
  name: string
  avatarUrl: string | null
  shift: ProfileShift | null
  days: { date: ISODate; minutes: number; open: number; status: DayStatus }[]
  minutes: number
  /** Weekly target after excused days; null without a shift. */
  target: number | null
  pay: WeekPay | null
}

export interface WorkshopRow {
  id: string
  name: string
  shift: ProfileShift | null
  /** payroll = the weekly sheet in Nómina; clock = a workshop person with an account who clocks in. */
  source: 'payroll' | 'clock'
  days: { date: ISODate; minutes: number; draft: boolean }[]
  minutes: number
  /** Days still in draft: they do not count for the cut until the admin confirms them. */
  drafts: number
}

export function buildOfficeRows(
  profiles: readonly OfficeProfile[],
  entries: readonly EntryLike[],
  excused: readonly Pick<ExcusedDay, 'work_date' | 'user_id' | 'kind'>[],
  weekStart: ISODate,
  today: ISODate,
): OfficeRow[] {
  return profiles.map((p) => {
    const week = buildWeekView(entries.filter((e) => e.user_id === p.id), weekStart)
    const excuses = excusesFor(excused, p.id)
    const points = weekChartData(week, p.shift, excuses, today)
    return {
      id: p.id,
      name: p.display_name,
      avatarUrl: p.avatar_url ?? null,
      shift: p.shift,
      days: points.map((d) => ({ date: d.date, minutes: d.minutes, open: d.open, status: d.status })),
      minutes: week.minutes,
      target: weekTargetMinutes(week, p.shift, excuses),
      pay: officeWeekPay(week, p.shift, p.hourly_rate),
    }
  })
}

export function buildWorkshopRows(
  employees: readonly Pick<PayrollEmployee, 'id' | 'name' | 'shift'>[],
  days: readonly Pick<PayrollDay, 'employee_id' | 'work_date' | 'worked_minutes' | 'status'>[],
  weekDates: readonly ISODate[],
): WorkshopRow[] {
  return employees.map((e) => {
    const mine = days.filter((d) => d.employee_id === e.id)
    const perDay = weekDates.map((date) => {
      const day = mine.find((d) => d.work_date === date)
      return { date, minutes: day?.worked_minutes ?? 0, draft: day?.status === 'draft' }
    })
    return {
      id: e.id,
      name: e.name,
      shift: e.shift,
      source: 'payroll' as const,
      days: perDay,
      minutes: perDay.reduce((sum, d) => sum + d.minutes, 0),
      drafts: perDay.filter((d) => d.draft).length,
    }
  })
}

/** Workshop people with an account: hours from the clock, never a pay estimate (the workshop has no amount). */
export function buildClockWorkshopRows(
  profiles: readonly Pick<Profile, 'id' | 'display_name' | 'shift'>[],
  entries: readonly EntryLike[],
  weekStart: ISODate,
): WorkshopRow[] {
  return profiles.map((p) => {
    const week = buildWeekView(entries.filter((e) => e.user_id === p.id), weekStart)
    return {
      id: p.id,
      name: p.display_name,
      shift: p.shift,
      source: 'clock' as const,
      days: week.days.map((d) => ({ date: d.date, minutes: d.minutes, draft: false })),
      minutes: week.minutes,
      drafts: 0,
    }
  })
}

export function teamTotals(office: readonly OfficeRow[], workshop: readonly WorkshopRow[]) {
  return {
    officeMinutes: office.reduce((sum, r) => sum + r.minutes, 0),
    officePay: Math.round(office.reduce((sum, r) => sum + (r.pay?.amount ?? 0), 0) * 100) / 100,
    workshopMinutes: workshop.reduce((sum, r) => sum + r.minutes, 0),
  }
}

// ─── Who has the most hours (2026-10-05) ───

/** The month a Monday→Sunday week belongs to: the one holding its Thursday, i.e. most of its days. */
export const monthOfWeek = (weekStart: ISODate): string => monthOf(shiftDays(weekStart, 3))

/** Closed punches only, per person, inside [from, to]. */
export function clockMinutesByPerson(entries: readonly EntryLike[], from: ISODate, to: ISODate): Map<string, number> {
  const out = new Map<string, number>()
  for (const e of entries) {
    if (e.work_date < from || e.work_date > to) continue
    const minutes = minutesBetween(e.clock_in, e.clock_out)
    if (minutes != null) out.set(e.user_id, (out.get(e.user_id) ?? 0) + minutes)
  }
  return out
}

/** Nómina days per employee inside [from, to], drafts included: it is "registered", not "paid". */
export function payrollMinutesByEmployee(
  days: readonly Pick<PayrollDay, 'employee_id' | 'work_date' | 'worked_minutes'>[],
  from: ISODate,
  to: ISODate,
): Map<string, number> {
  const out = new Map<string, number>()
  for (const d of days) {
    if (d.work_date < from || d.work_date > to) continue
    out.set(d.employee_id, (out.get(d.employee_id) ?? 0) + d.worked_minutes)
  }
  return out
}

export interface HoursLeader {
  id: string
  name: string
  area: ProfileArea
  minutes: number
}

/** Most hours first; people with nothing registered are left out, ties keep name order. */
export function rankLeaders(
  people: readonly { id: string; name: string; area: ProfileArea }[],
  minutes: ReadonlyMap<string, number>,
  limit = 3,
): HoursLeader[] {
  return people
    .map((p) => ({ ...p, minutes: minutes.get(p.id) ?? 0 }))
    .filter((p) => p.minutes > 0)
    .sort((a, b) => b.minutes - a.minutes || a.name.localeCompare(b.name, 'es'))
    .slice(0, limit)
}
