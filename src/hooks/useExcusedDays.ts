'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchJson } from '@/lib/fetch-json'
import { TIME_ENTRIES_KEY } from '@/hooks/useTimeEntries'
import type { ExcusedDay, ExcusedDayInsert } from '@/types/database'

export const EXCUSED_DAYS_KEY = ['excused-days']

export function useExcusedDays(from: string) {
  return useQuery({
    queryKey: [...EXCUSED_DAYS_KEY, { from }],
    queryFn: () => fetchJson<ExcusedDay[]>(`/api/excused-days?from=${from}`),
  })
}

function useInvalidate() {
  const queryClient = useQueryClient()
  return () => {
    queryClient.invalidateQueries({ queryKey: EXCUSED_DAYS_KEY })
    // The week view discounts these days: refresh it too.
    queryClient.invalidateQueries({ queryKey: TIME_ENTRIES_KEY })
  }
}

export function useCreateExcusedDay() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (day: ExcusedDayInsert) =>
      fetchJson<ExcusedDay>('/api/excused-days', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(day),
      }),
    onSuccess: invalidate,
  })
}

export function useDeleteExcusedDay() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (id: string) => fetchJson<{ ok: true }>(`/api/excused-days/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  })
}
