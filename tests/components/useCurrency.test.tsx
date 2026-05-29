import { describe, test, expect, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useCurrency } from '@/hooks/useCurrency'
import { useDiscreteModeStore } from '@/stores/discreteModeStore'
import { resetStores } from './helpers/stores'

describe('useCurrency', () => {
  beforeEach(() => resetStores())

  test('null/undefined → "—"', () => {
    const { result } = renderHook(() => useCurrency())
    expect(result.current(null)).toBe('—')
    expect(result.current(undefined)).toBe('—')
  })

  test('modo normal → formato es-MX con 2 decimales', () => {
    const { result } = renderHook(() => useCurrency())
    expect(result.current(1234)).toBe('$1,234.00')
    expect(result.current(100)).toBe('$100.00')
    expect(result.current(0)).toBe('$0.00')
  })

  test('modo discreto → valor enmascarado', () => {
    useDiscreteModeStore.setState({ isDiscreteMode: true })
    const { result } = renderHook(() => useCurrency())
    expect(result.current(1234)).toBe('$•,•••.••')
  })

  test('en modo discreto, null sigue siendo "—" (no se enmascara)', () => {
    useDiscreteModeStore.setState({ isDiscreteMode: true })
    const { result } = renderHook(() => useCurrency())
    expect(result.current(null)).toBe('—')
  })
})
