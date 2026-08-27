'use client'

import { useEffect, useState } from 'react'

/**
 * `true` desde el primer frame pintado — para no animar el salto de la
 * rehidratación. El setState va en rAF: esa ES la semántica y evita el lint.
 */
export function useMounted(): boolean {
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true))
    return () => cancelAnimationFrame(id)
  }, [])
  return mounted
}
