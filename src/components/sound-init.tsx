'use client'

import { useEffect } from 'react'
import { initSounds } from '@/lib/sound'
import { useSoundStore } from '@/stores/soundStore'

/** Boots sounds once from the persisted preference; login is deliberately silent. */
export function SoundInit() {
  const soundEnabled = useSoundStore((s) => s.soundEnabled)

  useEffect(() => {
    initSounds(soundEnabled)
    // Mount only: SoundToggle syncs later changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return null
}
