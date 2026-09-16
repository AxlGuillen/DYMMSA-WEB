'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchJson } from '@/lib/fetch-json'
import { ORDERS_KEY } from '@/hooks/useOrders'

export const SETTINGS_KEY = ['settings']

/** Updates app_settings; the server enforces the key whitelist. */
export function useUpdateSettings() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (settings: Record<string, unknown>) =>
      fetchJson<{ settings: Record<string, unknown> }>('/api/settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ settings }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SETTINGS_KEY })
      // A threshold change re-scores every cached purchase plan.
      queryClient.invalidateQueries({ queryKey: ORDERS_KEY })
    },
  })
}
