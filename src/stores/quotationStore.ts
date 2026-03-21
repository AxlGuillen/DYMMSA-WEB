import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { QuotationItemRow } from '@/types/database'

interface QuotationDraftState {
  name: string
  customer_name: string
  items: QuotationItemRow[]
}

interface QuotationStore extends QuotationDraftState {
  setName: (name: string) => void
  setCustomerName: (name: string) => void
  setItems: (items: QuotationItemRow[]) => void
  updateItem: (id: string, updates: Partial<Omit<QuotationItemRow, '_id'>>) => void
  addItem: (item: Omit<QuotationItemRow, '_id'>) => void
  removeItem: (id: string) => void
  reorderItems: (activeId: string, overId: string) => void
  reset: () => void
}

const INITIAL_STATE: QuotationDraftState = {
  name: '',
  customer_name: '',
  items: [],
}

export const useQuotationStore = create<QuotationStore>()(
  persist(
    (set) => ({
      ...INITIAL_STATE,

      setName: (name) => set({ name }),

      setCustomerName: (name) => set({ customer_name: name }),

      setItems: (items) => set({ items }),

      updateItem: (id, updates) =>
        set((state) => ({
          items: state.items.map((item) =>
            item._id === id ? { ...item, ...updates } : item
          ),
        })),

      addItem: (item) =>
        set((state) => ({
          items: [
            ...state.items,
            { ...item, _id: crypto.randomUUID() },
          ],
        })),

      removeItem: (id) =>
        set((state) => ({
          items: state.items.filter((item) => item._id !== id),
        })),

      reorderItems: (activeId, overId) =>
        set((state) => {
          const oldIndex = state.items.findIndex((item) => item._id === activeId)
          const newIndex = state.items.findIndex((item) => item._id === overId)
          if (oldIndex === -1 || newIndex === -1) return state
          const next = [...state.items]
          const [moved] = next.splice(oldIndex, 1)
          next.splice(newIndex, 0, moved)
          return { items: next }
        }),

      reset: () => set(INITIAL_STATE),
    }),
    {
      name: 'dymmsa-quotation-draft',
    }
  )
)
