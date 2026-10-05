'use client'

import { useQuery } from '@tanstack/react-query'
import { fetchJson } from '@/lib/fetch-json'
import type { HoursLeader, OfficeRow, WorkshopRow } from '@/lib/team-hours'

export interface TeamHoursResponse {
  start: string
  end: string
  office: OfficeRow[]
  workshop: WorkshopRow[]
  totals: { officeMinutes: number; officePay: number; workshopMinutes: number }
  /** Top 3 by registered hours: the visible week and the month that holds it. */
  leaders: { week: HoursLeader[]; month: { month: string; ranking: HoursLeader[] } }
}

export function useTeamHours(week: string) {
  return useQuery({
    queryKey: ['time-entries', 'team-overview', week],
    queryFn: () => fetchJson<TeamHoursResponse>(`/api/hours/overview?week=${week}`),
  })
}
