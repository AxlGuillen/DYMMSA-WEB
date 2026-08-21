import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { CutPlanCandidate } from '@/hooks/useCutPlan'
import type { PieceDraft } from '@/components/orders/CutPlanner'

/**
 * Borrador del corte rápido (#71): efímero a propósito, jamás en BD (ADR-022).
 * localStorage solo evita perder la captura por un refresh.
 */
interface CutDraftState {
  drafts: PieceDraft[]
  candidates: CutPlanCandidate[]
  /** Nombre de la cotización que sembró los candidatos (contexto en el header). */
  seededFrom: string | null
}

interface CutDraftStore extends CutDraftState {
  setDrafts: (drafts: PieceDraft[]) => void
  seed: (candidates: CutPlanCandidate[], from: string | null) => void
  clear: () => void
}

const initialState: CutDraftState = { drafts: [], candidates: [], seededFrom: null }

export const useCutDraftStore = create<CutDraftStore>()(
  persist(
    (set) => ({
      ...initialState,
      setDrafts: (drafts) => set({ drafts }),
      // Sembrar reemplaza los candidatos previos pero CONSERVA las piezas ya
      // capturadas (venir de otra cotización no debe borrar trabajo manual).
      seed: (candidates, from) => set({ candidates, seededFrom: from }),
      clear: () => set(initialState),
    }),
    { name: 'dymmsa-cut-draft' }
  )
)
