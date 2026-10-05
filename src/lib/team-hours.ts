/** Admin team overview (2026-10-05): the office from the clock (Horas), the workshop from Nómina. Pure; clock injected. */

import { officeWeekPay, type WeekPay } from './office-pay'
import {
  buildWeekView,
  excusesFor,
  weekChartData,
  weekTargetMinutes,
  type DayStatus,
  type ISODate,
} from './timesheet'
import type { ExcusedDay, PayrollDay, PayrollEmployee, Profile, ProfileShift } from '@/types/database'

type EntryLike = { user_id: string; work_date: string; clock_in: string; clock_out: string | null }
type OfficeProfile = Pick<Profile, 'id' | 'display_name' | 'shift' | 'hourly_rate'> & { avatar_url?: string | null }

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
  shift: ProfileShift
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
      days: perDay,
      minutes: perDay.reduce((sum, d) => sum + d.minutes, 0),
      drafts: perDay.filter((d) => d.draft).length,
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
