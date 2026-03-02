import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { QuotationItemRow } from '@/types/database'

interface QuotationDraftState {
  customer_name: string
  items: QuotationItemRow[]
}

interface QuotationStore extends QuotationDraftState {
  setCustomerName: (name: string) => void
  setItems: (items: QuotationItemRow[]) => void
  updateItem: (id: string, updates: Partial<Omit<QuotationItemRow, '_id'>>) => void
  addItem: (item: Omit<QuotationItemRow, '_id'>) => void
  removeItem: (id: string) => void
  reset: () => void
}

const INITIAL_STATE: QuotationDraftState = {
  customer_name: '',
  items: [],
}

export const useQuotationStore = create<QuotationStore>()(
  persist(
    (set) => ({
      ...INITIAL_STATE,

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

      reset: () => set(INITIAL_STATE),
    }),
    {
      name: 'dymmsa-quotation-draft',
    }
  )
)
