'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchJson } from '@/lib/fetch-json'
import type { Profile, ProfileUpdate } from '@/types/database'

export const PROFILE_KEY = ['profile']
export const PROFILES_KEY = ['profiles']

export type OwnProfile = Pick<Profile, 'id' | 'display_name' | 'role' | 'clock_employee_id'>

/** The caller's profile. `isAdmin` only decides what the UI shows; the server enforces (ADR-026). */
export function useProfile() {
  const query = useQuery({
    queryKey: PROFILE_KEY,
    queryFn: () => fetchJson<OwnProfile>('/api/profile'),
    staleTime: 5 * 60_000,
  })
  return { ...query, profile: query.data ?? null, isAdmin: query.data?.role === 'admin' }
}

export function useProfiles(enabled = true) {
  return useQuery({
    queryKey: PROFILES_KEY,
    queryFn: () => fetchJson<Profile[]>('/api/profiles'),
    enabled,
  })
}

export function useUpdateProfile() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: ProfileUpdate }) =>
      fetchJson<Profile>(`/api/profiles/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(updates),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PROFILES_KEY })
      queryClient.invalidateQueries({ queryKey: PROFILE_KEY })
    },
  })
}
