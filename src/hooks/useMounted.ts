'use client'

import { useEffect, useState } from 'react'

/**
 * `true` from the first painted frame, so the rehydration jump is not animated.
 * setState inside rAF is the intended semantics (and keeps lint quiet).
 */
export function useMounted(): boolean {
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true))
    return () => cancelAnimationFrame(id)
  }, [])
  return mounted
}
