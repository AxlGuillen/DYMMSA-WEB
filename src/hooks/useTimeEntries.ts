'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchJson } from '@/lib/fetch-json'
import type { WeekView } from '@/lib/timesheet'
import type { TimeEntry, TimeEntryUpdate, TimeImport, TimeImportResult } from '@/types/database'

export const TIME_ENTRIES_KEY = ['time-entries']

export interface TimeEntriesResponse {
  user: string
  from: string
  to: string
  entries: TimeEntry[]
  /** null when from..to is not an exact Monday→Sunday week. */
  week: WeekView<TimeEntry> | null
}

interface TimeEntriesParams {
  /** Admin-only; the server ignores it for members. */
  user?: string | null
  from: string
  to: string
}

export function useTimeEntries({ user, from, to }: TimeEntriesParams) {
  return useQuery({
    queryKey: [...TIME_ENTRIES_KEY, { user: user ?? null, from, to }],
    queryFn: () => {
      const qs = new URLSearchParams({ from, to })
      if (user) qs.set('user', user)
      return fetchJson<TimeEntriesResponse>(`/api/time-entries?${qs}`)
    },
  })
}

export function useTimeImports() {
  return useQuery({
    queryKey: [...TIME_ENTRIES_KEY, 'imports'],
    queryFn: () => fetchJson<TimeImport[]>('/api/time-entries/imports'),
  })
}

export interface ManualTimeEntry {
  user_id: string
  work_date: string
  clock_in: string
  clock_out: string | null
  note: string | null
}

// Multipart: fetchJson only speaks JSON (same as useImportInventory).
export function useImportTimeEntries() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (file: File): Promise<TimeImportResult> => {
      const formData = new FormData()
      formData.append('file', file)
      const response = await fetch('/api/time-entries/import', { method: 'POST', body: formData })
      if (!response.ok) {
        const error = await response.json().catch(() => ({}))
        throw new Error(error.message || 'No se pudo importar el reporte')
      }
      return response.json()
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: TIME_ENTRIES_KEY }),
  })
}

export function useCreateTimeEntry() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (entry: ManualTimeEntry) =>
      fetchJson<TimeEntry>('/api/time-entries', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(entry),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: TIME_ENTRIES_KEY }),
  })
}

export function useUpdateTimeEntry() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: TimeEntryUpdate }) =>
      fetchJson<TimeEntry>(`/api/time-entries/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(updates),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: TIME_ENTRIES_KEY }),
  })
}

export function useDeleteTimeEntry() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => fetchJson<{ ok: true }>(`/api/time-entries/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: TIME_ENTRIES_KEY }),
  })
}
