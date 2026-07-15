'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchJson } from '@/lib/fetch-json'
import { ORDERS_KEY } from '@/hooks/useOrders'
import type { PurchasePlan } from '@/lib/purchase-plan'
import type { OrderPurchaseDecision } from '@/types/database'

export interface PurchasePlanResponse {
  order: { id: string; name: string; status: string; customer_name: string }
  plan: PurchasePlan
}

/**
 * Plan de compra de una orden (ADR-018), calculado en el servidor.
 *
 * Key anidada bajo [ORDERS_KEY, orderId]: toda mutación existente de la orden
 * (agregar/editar/quitar ítems, recepción) ya invalida ese prefijo → el plan y
 * su staleness se recalculan solos.
 */
export function usePurchasePlan(orderId: string) {
  return useQuery({
    queryKey: [...ORDERS_KEY, orderId, 'purchase-plan'],
    queryFn: async (): Promise<PurchasePlanResponse> =>
      fetchJson<PurchasePlanResponse>(`/api/orders/${orderId}/purchase-plan`),
    enabled: !!orderId,
  })
}

export interface SaveDecisionInput {
  model_code: string
  brand: string
  std_snapshot: number
  needed_qty: number
  packages_wholesale: number
  qty_retail: number
}

/** Reemplaza el set completo de decisiones de compra de la orden. */
export function useSavePurchaseDecisions(orderId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (decisions: SaveDecisionInput[]) =>
      fetchJson<{ decisions: OrderPurchaseDecision[] }>(
        `/api/orders/${orderId}/purchase-decisions`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ decisions }),
        },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...ORDERS_KEY, orderId, 'purchase-plan'] })
    },
  })
}
