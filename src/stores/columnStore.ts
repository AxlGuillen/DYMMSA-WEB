import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * Columnas ocultas por tabla (#18). Solo se persiste lo OCULTO: columnas nuevas
 * aparecen solas sin migración. Renombrar un id huerfanea la preferencia.
 */
interface ColumnStore {
  /** tableId → ids de columnas ocultas por el usuario. */
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
          // Borra la key completa (no deja []) para no acumular entradas vacías.
          const { [tableId]: _removed, ...rest } = state.hidden
          return { hidden: rest }
        }),
    }),
    { name: 'dymmsa-columns', version: 1 },
  ),
)
