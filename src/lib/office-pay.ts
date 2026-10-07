/**
 * Office pay estimate (2026-10-05): Monday–Friday (and a Sunday, if any) at the person's rate, plus
 * the Saturday the office is given — a worked Saturday replaces the gift, it is never paid twice
 * (review PR #137). The workshop's Saturday/Sunday rules live in payroll, not here.
 */

import { SHIFT_HOURS, type WeekView } from './timesheet'
import type { ProfileShift } from '@/types/database'

export const DEFAULT_HOURLY_RATE = 52

export interface WeekPay {
  rate: number
  /** Closed punches Monday–Friday and Sunday; a pair without clock-out adds nothing, as in the week total. */
  workedMinutes: number
  /** Hours counted for Saturday: the shift's daily hours (worked or not) or the worked ones if more; 0 without a shift. */
  saturdayHours: number
  paidHours: number
  amount: number
}

const round2 = (n: number) => Math.round(n * 100) / 100
const SATURDAY = 5

type WeekLike = Pick<WeekView<unknown>, 'days'>

/** Overtime is paid at the same rate; null = no rate, no estimate. */
export function officeWeekPay(week: WeekLike, shift: ProfileShift | null | undefined, rate: number | null | undefined): WeekPay | null {
  if (rate == null || !(rate > 0)) return null
  const workedMinutes = week.days.reduce((sum, d, i) => (i === SATURDAY ? sum : sum + d.minutes), 0)
  const saturdayWorked = (week.days[SATURDAY]?.minutes ?? 0) / 60
  const saturdayHours = Math.max(shift ? SHIFT_HOURS[shift].daily : 0, saturdayWorked)
  const paidHours = workedMinutes / 60 + saturdayHours
  return { rate, workedMinutes, saturdayHours: round2(saturdayHours), paidHours: round2(paidHours), amount: round2(paidHours * rate) }
}

/** Numeric columns can arrive as strings from PostgREST; coerce at the boundary, never trust them raw. */
export function parseRate(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = typeof value === 'number' ? value : Number(value)
  // Rounded BEFORE the check: 0.004 would pass as > 0 and then hit the CHECK (> 0) as 0 (review PR #137).
  const rounded = round2(n)
  return Number.isFinite(n) && rounded > 0 ? rounded : null
}
