import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface DiscreteModeState {
  isDiscreteMode: boolean
}

interface DiscreteModeStore extends DiscreteModeState {
  toggleDiscreteMode: () => void
}

export const useDiscreteModeStore = create<DiscreteModeStore>()(
  persist(
    (set) => ({
      isDiscreteMode: false,
      toggleDiscreteMode: () =>
        set((state) => ({ isDiscreteMode: !state.isDiscreteMode })),
    }),
    { name: 'dymmsa-discrete-mode' }
  )
)
