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

/** Plan de compra server-side (ADR-018); key bajo [ORDERS_KEY, id] → se recalcula con cada mutación. */
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
