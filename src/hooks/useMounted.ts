'use client'

import { useEffect, useState } from 'react'

/**
 * `true` a partir del primer frame pintado en el cliente.
 *
 * Uso típico: habilitar clases de transición DESPUÉS de la primera pintura,
 * para no animar el "salto" de la rehidratación (p. ej. el ancho del sidebar
 * al restaurar `collapsed` desde localStorage).
 *
 * El setState va dentro de requestAnimationFrame (asíncrono) y no en el cuerpo
 * del efecto: espera a que el primer frame ya esté pintado — que es exactamente
 * la semántica buscada — y evita el render en cascada que marca
 * react-hooks/set-state-in-effect.
 */
export function useMounted(): boolean {
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true))
    return () => cancelAnimationFrame(id)
  }, [])
  return mounted
}
