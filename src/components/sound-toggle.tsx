'use client'

import { Headphones, HeadphonesOff } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { useSoundStore } from '@/stores/soundStore'
import { useMounted } from '@/hooks/useMounted'
import { setSoundEnabled, playSound } from '@/lib/sound'

export function SoundToggle() {
  const { soundEnabled, toggleSound } = useSoundStore()
  // SSR-safe: the server always renders "on"; branching at hydration shifted the
  // tree and every useId on the page.
  const mounted = useMounted()
  const showEnabled = mounted ? soundEnabled : true

  const handleToggle = () => {
    const next = !soundEnabled
    toggleSound()
    setSoundEnabled(next)
    // Immediate feedback on re-enabling: "this is what you just turned on".
    if (next) playSound('toggle')
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={handleToggle}
      aria-label={showEnabled ? 'Silenciar sonidos' : 'Activar sonidos'}
      title={showEnabled ? 'Sonidos activos' : 'Sonidos silenciados'}
    >
      {showEnabled ? (
        <Headphones className="size-5" />
      ) : (
        <HeadphonesOff className="size-5" />
      )}
    </Button>
  )
}
