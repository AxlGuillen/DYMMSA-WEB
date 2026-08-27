'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchJson } from '@/lib/fetch-json'
import { ORDERS_KEY } from '@/hooks/useOrders'

export const SETTINGS_KEY = ['settings']

/** Actualiza app_settings (whitelist en el server); la lectura llega ya resuelta en cada consumidor. */
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
      // Un cambio de umbral re-puntúa todos los planes de compra cacheados.
      queryClient.invalidateQueries({ queryKey: ORDERS_KEY })
    },
  })
}
