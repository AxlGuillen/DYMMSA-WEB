import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * Only HIDDEN columns are persisted (#18), so new columns show up without a migration.
 * Renaming an id orphans the preference.
 */
interface ColumnStore {
  /** tableId → column ids hidden by the user. */
  hidden: Record<string, string[]>
  toggleColumn: (tableId: string, columnId: string) => void
  resetTable: (tableId: string) => void
}

export const useColumnStore = create<ColumnStore>()(
  persist(
    (set) => ({
      hidden: {},
      toggleColumn: (tableId, columnId) =>
        set((state) => {
          const current = state.hidden[tableId] ?? []
          const next = current.includes(columnId)
            ? current.filter((id) => id !== columnId)
            : [...current, columnId]
          return { hidden: { ...state.hidden, [tableId]: next } }
        }),
      resetTable: (tableId) =>
        set((state) => {
          // Drop the whole key instead of leaving [] behind.
          const { [tableId]: _removed, ...rest } = state.hidden
          return { hidden: rest }
        }),
    }),
    { name: 'dymmsa-columns', version: 1 },
  ),
)
