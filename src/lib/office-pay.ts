/** Office pay estimate (2026-10-05): every hour at the person's rate, plus the Saturday they are given. */

import { SHIFT_HOURS, type WeekView } from './timesheet'
import type { ProfileShift } from '@/types/database'

export const DEFAULT_HOURLY_RATE = 52

export interface WeekPay {
  rate: number
  /** Closed punches only: a pair without clock-out adds nothing, as in the week total. */
  workedMinutes: number
  /** The paid Saturday: the shift's daily hours, worked or not; 0 without a shift. */
  saturdayHours: number
  paidHours: number
  amount: number
}

const round2 = (n: number) => Math.round(n * 100) / 100

/** Overtime and a worked Saturday are paid at the same rate; null = no rate, no estimate. */
export function officeWeekPay(week: Pick<WeekView<unknown>, 'minutes'>, shift: ProfileShift | null | undefined, rate: number | null | undefined): WeekPay | null {
  if (rate == null || !(rate > 0)) return null
  const saturdayHours = shift ? SHIFT_HOURS[shift].daily : 0
  const paidHours = week.minutes / 60 + saturdayHours
  return { rate, workedMinutes: week.minutes, saturdayHours, paidHours: round2(paidHours), amount: round2(paidHours * rate) }
}

/** Numeric columns can arrive as strings from PostgREST; coerce at the boundary, never trust them raw. */
export function parseRate(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) && n > 0 ? round2(n) : null
}
