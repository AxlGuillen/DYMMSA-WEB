import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * Preferencias de columnas visibles por tabla (issue #18).
 *
 * Solo se persisten las columnas OCULTAS: el default es "todo visible", así
 * que las columnas nuevas que se agreguen a una tabla aparecen solas sin
 * migración. Los ids de columna son API persistida — renombrar uno deja la
 * preferencia huérfana (la columna vuelve a visible, inofensivo); si algún
 * día hace falta renombrar en serio, subir `version` + `migrate` (patrón de
 * quotationStore).
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
