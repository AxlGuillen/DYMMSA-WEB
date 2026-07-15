'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchJson } from '@/lib/fetch-json'
import { ORDERS_KEY } from '@/hooks/useOrders'

export const SETTINGS_KEY = ['settings']

/**
 * Actualiza configuración key-value (app_settings). La whitelist de keys
 * válidas vive en el servidor (/api/settings). Los valores actuales llegan a
 * la UI ya resueltos dentro de sus consumidores (ej. plan.thresholds del
 * planificador) — por eso aún no hay hook de lectura.
 */
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
