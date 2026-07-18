'use client'

import { useEffect } from 'react'
import { initSounds } from '@/lib/sound'
import { useSoundStore } from '@/stores/soundStore'

/**
 * Arranca los sonidos de UI una vez, con la preferencia persistida del usuario.
 * Se monta en el layout del dashboard y en la página pública de aprobación
 * (/approve/[token], con su SoundToggle en el header — decisión 2026-07-17).
 * El login queda sin sonidos a propósito.
 */
export function SoundInit() {
  const soundEnabled = useSoundStore((s) => s.soundEnabled)

  useEffect(() => {
    initSounds(soundEnabled)
    // Solo al montar: los cambios posteriores los sincroniza SoundToggle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return null
}
