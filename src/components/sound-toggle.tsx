'use client'

import { Headphones, HeadphonesOff } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { useSoundStore } from '@/stores/soundStore'
import { setSoundEnabled, playSound } from '@/lib/sound'

export function SoundToggle() {
  const { soundEnabled, toggleSound } = useSoundStore()

  const handleToggle = () => {
    const next = !soundEnabled
    toggleSound()
    setSoundEnabled(next)
    // Feedback inmediato al re-activar: "esto es lo que acabas de encender".
    if (next) playSound('toggle')
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={handleToggle}
      aria-label={soundEnabled ? 'Silenciar sonidos' : 'Activar sonidos'}
      title={soundEnabled ? 'Sonidos activos' : 'Sonidos silenciados'}
    >
      {soundEnabled ? (
        <Headphones className="size-5" />
      ) : (
        <HeadphonesOff className="size-5" />
      )}
    </Button>
  )
}
