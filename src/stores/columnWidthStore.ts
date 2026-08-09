import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * Anchos de columna personalizados por tabla (issue #55, tipo Excel).
 *
 * Store aparte de `columnStore` (visibilidad) a propósito: son preferencias
 * independientes y así no hay que versionar/migrar un store que ya funciona.
 * Solo se persisten los anchos que el usuario ARRASTRÓ — el resto sale del
 * default declarado en la columna, así que cambiar un default en código se
 * refleja solo para quien no lo haya tocado.
 */
interface ColumnWidthStore {
  /** tableId → columnId → ancho en px. */
  widths: Record<string, Record<string, number>>
  setWidth: (tableId: string, columnId: string, width: number) => void
  resetColumn: (tableId: string, columnId: string) => void
  resetTable: (tableId: string) => void
}

export const useColumnWidthStore = create<ColumnWidthStore>()(
  persist(
    (set) => ({
      widths: {},
      setWidth: (tableId, columnId, width) =>
        set((state) => ({
          widths: {
            ...state.widths,
            [tableId]: { ...(state.widths[tableId] ?? {}), [columnId]: width },
          },
        })),
      resetColumn: (tableId, columnId) =>
        set((state) => {
          const table = state.widths[tableId]
          if (!table || !(columnId in table)) return state
          const { [columnId]: _removed, ...rest } = table
          // Sin anchos custom se borra la tabla entera (no deja {} acumulado).
          if (Object.keys(rest).length === 0) {
            const { [tableId]: _dropped, ...others } = state.widths
            return { widths: others }
          }
          return { widths: { ...state.widths, [tableId]: rest } }
        }),
      resetTable: (tableId) =>
        set((state) => {
          const { [tableId]: _removed, ...rest } = state.widths
          return { widths: rest }
        }),
    }),
    { name: 'dymmsa-column-widths', version: 1 },
  ),
)
