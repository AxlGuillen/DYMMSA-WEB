import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface CollapsedSectionsStore {
  /** Section id → collapsed; anything missing is expanded. */
  collapsed: Record<string, boolean>
  toggle: (id: string) => void
  setAll: (ids: readonly string[], value: boolean) => void
}

export const useCollapsedSectionsStore = create<CollapsedSectionsStore>()(
  persist(
    (set) => ({
      collapsed: {},
      toggle: (id) => set((s) => ({ collapsed: { ...s.collapsed, [id]: !s.collapsed[id] } })),
      setAll: (ids, value) => set((s) => ({ collapsed: { ...s.collapsed, ...Object.fromEntries(ids.map((id) => [id, value])) } })),
    }),
    { name: 'dymmsa-collapsed-sections' },
  ),
)
