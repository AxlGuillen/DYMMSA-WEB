'use client'

import { Eye, EyeOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useDiscreteModeStore } from '@/stores/discreteModeStore'

export function DiscreteModeToggle() {
  const { isDiscreteMode, toggleDiscreteMode } = useDiscreteModeStore()

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggleDiscreteMode}
      aria-label={isDiscreteMode ? 'Desactivar modo discreto' : 'Activar modo discreto'}
      title={isDiscreteMode ? 'Modo discreto activo — precios ocultos' : 'Activar modo discreto'}
    >
      {isDiscreteMode ? (
        <EyeOff className="h-5 w-5" />
      ) : (
        <Eye className="h-5 w-5" />
      )}
    </Button>
  )
}
