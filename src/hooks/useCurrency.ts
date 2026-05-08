'use client'

import { useDiscreteModeStore } from '@/stores/discreteModeStore'

const MASKED = '$•,•••.••'

export function useCurrency() {
  const isDiscreteMode = useDiscreteModeStore((s) => s.isDiscreteMode)
  return (value: number | null | undefined): string => {
    if (value == null) return '—'
    if (isDiscreteMode) return MASKED
    return `$${value.toLocaleString('es-MX', { minimumFractionDigits: 2 })}`
  }
}
