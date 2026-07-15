/**
 * Reset de los stores Zustand entre tests.
 *
 * Ambos stores son singletons de módulo con `persist` (localStorage), así que
 * el estado fuga entre tests si no se resetea. Llamar `resetStores()` en un
 * `beforeEach` de cualquier suite que toque el cotizador o el modo discreto.
 */

import { useQuotationStore } from '@/stores/quotationStore'
import { useDiscreteModeStore } from '@/stores/discreteModeStore'
import { useSidebarStore } from '@/stores/sidebarStore'
import { useSoundStore } from '@/stores/soundStore'
import type { QuotationItemRow } from '@/types/database'

export function resetStores() {
  useQuotationStore.setState({ name: '', customer_name: '', items: [] })
  useDiscreteModeStore.setState({ isDiscreteMode: false })
  useSidebarStore.setState({ collapsed: false })
  useSoundStore.setState({ soundEnabled: true })
  localStorage.clear()
}

/** Siembra items en el draft del cotizador (para QuotationEditor). */
export function seedQuotationItems(items: QuotationItemRow[]) {
  useQuotationStore.setState({ items })
}
