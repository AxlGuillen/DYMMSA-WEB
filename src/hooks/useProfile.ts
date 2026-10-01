'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchJson } from '@/lib/fetch-json'
import type { OwnProfile, OwnProfileUpdate, ProfileUpdate, ProfileWithAvatar } from '@/types/database'

export const PROFILE_KEY = ['profile']
export const PROFILES_KEY = ['profiles']

export type { OwnProfile }

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
    queryFn: () => fetchJson<ProfileWithAvatar[]>('/api/profiles'),
    enabled,
  })
}

function useInvalidateProfiles() {
  const queryClient = useQueryClient()
  return () => {
    queryClient.invalidateQueries({ queryKey: PROFILES_KEY })
    queryClient.invalidateQueries({ queryKey: PROFILE_KEY })
  }
}

export function useUpdateProfile() {
  const invalidate = useInvalidateProfiles()
  return useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: ProfileUpdate }) =>
      fetchJson<ProfileWithAvatar>(`/api/profiles/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(updates),
      }),
    onSuccess: invalidate,
  })
}

export function useUpdateOwnProfile() {
  const invalidate = useInvalidateProfiles()
  return useMutation({
    mutationFn: (updates: OwnProfileUpdate) =>
      fetchJson<OwnProfile>('/api/profile', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(updates),
      }),
    onSuccess: invalidate,
  })
}

export function useUploadAvatar() {
  const invalidate = useInvalidateProfiles()
  return useMutation({
    mutationFn: (image: Blob) => {
      const form = new FormData()
      form.set('file', image, image.type === 'image/png' ? 'avatar.png' : 'avatar.webp')
      return fetchJson<{ avatar_url: string }>('/api/profile/avatar', { method: 'POST', body: form })
    },
    onSuccess: invalidate,
  })
}

export function useRemoveAvatar() {
  const invalidate = useInvalidateProfiles()
  return useMutation({
    mutationFn: () => fetchJson<{ avatar_url: null }>('/api/profile/avatar', { method: 'DELETE' }),
    onSuccess: invalidate,
  })
}
