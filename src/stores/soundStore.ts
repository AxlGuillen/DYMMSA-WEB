import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * Default: activado, SALVO que el sistema pida menos movimiento. No existe
 * "prefers-reduced-sound"; reduced-motion es el mejor proxy de "no me
 * molestes con efectos". El usuario puede re-activarlo manualmente y su
 * elección persiste por encima de este default.
 */
function defaultEnabled(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return true
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

interface SoundState {
  soundEnabled: boolean
}

interface SoundStore extends SoundState {
  toggleSound: () => void
}

export const useSoundStore = create<SoundStore>()(
  persist(
    (set) => ({
      soundEnabled: defaultEnabled(),
      toggleSound: () => set((state) => ({ soundEnabled: !state.soundEnabled })),
    }),
    { name: 'dymmsa-sound' }
  )
)
