import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { CutPlanCandidate } from '@/hooks/useCutPlan'
import type { PieceDraft } from '@/components/orders/CutPlanner'

/**
 * Borrador del corte rápido (issue #71): el modo standalone es EFÍMERO por
 * decisión de diseño (ADR-022, enmienda #71) — no persiste en BD porque
 * cut_plan_pieces cuelga de una orden. localStorage evita perder la captura
 * por un refresh; "Limpiar" arranca de cero.
 *
 * `candidates` son las piezas DYMMSA sembradas desde una cotización (fase 2):
 * mismas sugerencias que el planner de orden, el usuario decide cuáles agregar.
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
