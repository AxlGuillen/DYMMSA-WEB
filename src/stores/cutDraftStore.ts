import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { CutPlanCandidate } from '@/hooks/useCutPlan'
import type { PieceDraft } from '@/components/orders/CutPlanner'

/**
 * Ephemeral by design, never in the DB (ADR-022, #71).
 * localStorage only keeps a refresh from losing the capture.
 */
interface CutDraftState {
  drafts: PieceDraft[]
  candidates: CutPlanCandidate[]
  /** Quotation that seeded the candidates; shown as header context. */
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
      // Seeding replaces candidates but KEEPS captured pieces: manual work survives.
      seed: (candidates, from) => set({ candidates, seededFrom: from }),
      clear: () => set(initialState),
    }),
    { name: 'dymmsa-cut-draft' }
  )
)
