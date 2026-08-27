'use client'

import { Headphones, HeadphonesOff } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { useSoundStore } from '@/stores/soundStore'
import { useMounted } from '@/hooks/useMounted'
import { setSoundEnabled, playSound } from '@/lib/sound'

export function SoundToggle() {
  const { soundEnabled, toggleSound } = useSoundStore()
  // SSR-safe: el server renderiza "activado" siempre — el branch en hidratación
  // descuadraba el árbol y todos los useId de la página.
  const mounted = useMounted()
  const showEnabled = mounted ? soundEnabled : true

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
