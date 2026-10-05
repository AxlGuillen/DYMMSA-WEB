'use client'

import { useQuery } from '@tanstack/react-query'
import { fetchJson } from '@/lib/fetch-json'
import type { OfficeRow, WorkshopRow } from '@/lib/team-hours'

export interface TeamHoursResponse {
  start: string
  end: string
  office: OfficeRow[]
  workshop: WorkshopRow[]
  totals: { officeMinutes: number; officePay: number; workshopMinutes: number }
}

export function useTeamHours(week: string) {
  return useQuery({
    queryKey: ['time-entries', 'team-overview', week],
    queryFn: () => fetchJson<TeamHoursResponse>(`/api/hours/overview?week=${week}`),
  })
}
