'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchJson } from '@/lib/fetch-json'
import { ORDERS_KEY } from '@/hooks/useOrders'
import { resolveCutMargin, SETTING_CUT_MARGIN_MM } from '@/lib/cut-plan'
import type { CutMaterialType, CutPlanPiece, MaterialPresentation } from '@/types/database'

/** Ítem DYMMSA de la orden, con las medidas nominales del producto (pre-llenado). */
export interface CutPlanCandidate {
  itemId: string
  etm: string | null
  description: string | null
  quantity: number
  cutKind: CutMaterialType | null
  diameterMm: number | null
  thicknessMm: number | null
  widthMm: number | null
  lengthMm: number | null
}

export interface CutPlanResponse {
  order: { id: string; name: string; customer_name: string; status: string }
  pieces: CutPlanPiece[]
  candidates: CutPlanCandidate[]
  presentations: MaterialPresentation[]
  marginMm: number
}

/**
 * Plan de corte de una orden (issue #59). Key anidada bajo [ORDERS_KEY,
 * orderId], igual que el plan de compra: las mutaciones de la orden ya
 * invalidan ese prefijo y la lista se refresca sola.
 */
export function useCutPlan(orderId: string) {
  return useQuery({
    queryKey: [...ORDERS_KEY, orderId, 'cut-plan'],
    queryFn: async (): Promise<CutPlanResponse> =>
      fetchJson<CutPlanResponse>(`/api/orders/${orderId}/cut-plan`),
    enabled: !!orderId,
  })
}

export interface SaveCutPieceInput {
  material_type: CutMaterialType
  diameter_mm?: number | null
  thickness_mm?: number | null
  width_mm?: number | null
  length_mm: number
  quantity: number
  requested_label?: string | null
  source_item_id?: string | null
}

/** Reemplaza la lista de corte completa de la orden (el body es el estado deseado). */
export function useSaveCutPlan(orderId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (pieces: SaveCutPieceInput[]) =>
      fetchJson<{ pieces: CutPlanPiece[] }>(`/api/orders/${orderId}/cut-plan`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pieces }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...ORDERS_KEY, orderId, 'cut-plan'] })
    },
  })
}

export interface SavePresentationInput {
  material_type: CutMaterialType
  diameter_mm?: number | null
  thickness_mm?: number | null
  width_mm?: number | null
  length_mm: number
}

export const PRESENTATIONS_KEY = ['material-presentations'] as const

/**
 * Registra la presentación que el proveedor ofreció ("barras de 6 m de Ø30").
 * El catálogo se arma solo: queda guardada y se sugiere en planes futuros.
 * `orderId` solo dirige la invalidación; el corte rápido pasa 'standalone'.
 */
export function useSavePresentation(orderId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (presentation: SavePresentationInput) =>
      fetchJson<MaterialPresentation>('/api/material-presentations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(presentation),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...ORDERS_KEY, orderId, 'cut-plan'] })
      queryClient.invalidateQueries({ queryKey: PRESENTATIONS_KEY })
    },
  })
}

/** Catálogo completo de medidas registradas (corte rápido + página de control). */
export function useMaterialPresentations() {
  return useQuery({
    queryKey: PRESENTATIONS_KEY,
    queryFn: async () =>
      fetchJson<{ presentations: MaterialPresentation[] }>('/api/material-presentations'),
  })
}

/** Elimina una medida registrada (captura errónea — issue #71). */
export function useDeletePresentation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) =>
      fetchJson<{ deleted: string }>(`/api/material-presentations/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PRESENTATIONS_KEY })
    },
  })
}

/** Margen de corte global (settings) para el modo standalone, ya resuelto. */
export function useCutMargin() {
  return useQuery({
    queryKey: ['settings', 'cut-margin'],
    queryFn: async () => {
      const { settings } = await fetchJson<{ settings: Record<string, unknown> }>(
        `/api/settings?keys=${SETTING_CUT_MARGIN_MM}`,
      )
      return resolveCutMargin(settings)
    },
  })
}
