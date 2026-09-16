/**
 * Both Zustand stores are module singletons with `persist`, so state leaks between tests:
 * call `resetStores()` in a `beforeEach`.
 */

import { useQuotationStore } from '@/stores/quotationStore'
import { useDiscreteModeStore } from '@/stores/discreteModeStore'
import { useSidebarStore } from '@/stores/sidebarStore'
import { useSoundStore } from '@/stores/soundStore'
import { useColumnStore } from '@/stores/columnStore'
import { useColumnWidthStore } from '@/stores/columnWidthStore'
import { useCutDraftStore } from '@/stores/cutDraftStore'
import { useDateFormatStore } from '@/stores/dateFormatStore'
import type { QuotationItemRow } from '@/types/database'

export function resetStores() {
  useQuotationStore.setState({ name: '', customer_name: '', items: [] })
  useDiscreteModeStore.setState({ isDiscreteMode: false })
  useSidebarStore.setState({ collapsed: false })
  useSoundStore.setState({ soundEnabled: true })
  useColumnStore.setState({ hidden: {} })
  useColumnWidthStore.setState({ widths: {} })
  useCutDraftStore.setState({ drafts: [], candidates: [], seededFrom: null })
  useDateFormatStore.setState({ dateFormat: 'long' })
  localStorage.clear()
}

/** Seeds items into the quoter draft (for QuotationEditor). */
export function seedQuotationItems(items: QuotationItemRow[]) {
  useQuotationStore.setState({ items })
}
