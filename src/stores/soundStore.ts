import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/** On by default unless reduced-motion (best proxy for "no effects"); manual choice wins. */
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
