'use client'

import { Headphones, HeadphonesOff } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { useSoundStore } from '@/stores/soundStore'
import { useMounted } from '@/hooks/useMounted'
import { setSoundEnabled, playSound } from '@/lib/sound'

export function SoundToggle() {
  const { soundEnabled, toggleSound } = useSoundStore()
  // SSR-safe (precedente del sidebar): el server siempre renderiza "activado";
  // el cliente puede arrancar silenciado (persistencia o reduced-motion) y ese
  // branch en la hidratación descuadraba el árbol — React re-renderizaba el
  // root y TODOS los useId (p.ej. aria-controls de los Select de la página de
  // aprobación) quedaban distintos al HTML del server.
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
