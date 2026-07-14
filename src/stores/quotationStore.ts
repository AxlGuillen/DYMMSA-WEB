import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { QuotationItemRow } from '@/types/database'

interface QuotationDraftState {
  name: string
  customer_name: string
  items: QuotationItemRow[]
  // Descripciones oficiales del catálogo, indexadas por `catalogKey` (MARCA|CODIGO
  // normalizados) — el match es por código Y marca. Derivado del lookup al
  // importar/editar; resuelve la columna "Desc. DYMMSA" (el catálogo gana
  // jerarquía sobre la curada del ítem).
  catalogDescriptions: Record<string, string>
}

interface QuotationStore extends QuotationDraftState {
  setName: (name: string) => void
  setCustomerName: (name: string) => void
  setItems: (items: QuotationItemRow[]) => void
  mergeCatalogDescriptions: (entries: Record<string, string>) => void
  updateItem: (id: string, updates: Partial<Omit<QuotationItemRow, '_id'>>) => void
  addItem: (item: Omit<QuotationItemRow, '_id'>) => void
  addSeparatorAfter: (afterId: string | null) => void
  removeItem: (id: string) => void
  reorderItems: (activeId: string, overId: string) => void
  reset: () => void
}

const INITIAL_STATE: QuotationDraftState = {
  name: '',
  customer_name: '',
  items: [],
  catalogDescriptions: {},
}

export const useQuotationStore = create<QuotationStore>()(
  persist(
    (set) => ({
      ...INITIAL_STATE,

      setName: (name) => set({ name }),

      setCustomerName: (name) => set({ customer_name: name }),

      setItems: (items) => set({ items }),

      mergeCatalogDescriptions: (entries) =>
        set((state) => ({
          catalogDescriptions: { ...state.catalogDescriptions, ...entries },
        })),

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

      addSeparatorAfter: (afterId) =>
        set((state) => {
          const separator: QuotationItemRow = {
            _id:            crypto.randomUUID(),
            item_type:      'separator',
            section_label:  '',
            etm:            '',
            dymmsa_description: '',
            description:    '',
            description_es: '',
            model_code:     '',
            brand:          '',
            unit_price:     null,
            quantity:       null,
            delivery_time:  'immediate',
            _inDb:          false,
          }
          if (afterId === null) {
            return { items: [separator, ...state.items] }
          }
          const idx = state.items.findIndex((i) => i._id === afterId)
          if (idx === -1) return { items: [...state.items, separator] }
          const next = [...state.items]
          next.splice(idx + 1, 0, separator)
          return { items: next }
        }),

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
      version: 1,
      // v0 → v1: `catalogDescriptions` pasó de estar indexado por CODIGO a
      // MARCA|CODIGO (match estricto por marca). Las llaves viejas ya no cruzan,
      // así que se descartan en vez de mostrar la descripción de otra marca. El
      // mapa es derivado (se repuebla en el próximo lookup) y el borrador —ítems,
      // nombre, cliente— se conserva intacto. Al guardar, el server resuelve la
      // descripción de cero, así que el dato persistido nunca depende de esto.
      migrate: (persisted): QuotationDraftState => ({
        ...(persisted as QuotationDraftState),
        catalogDescriptions: {},
      }),
    }
  )
)
