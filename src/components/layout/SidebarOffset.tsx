'use client'

import { useEffect, useState } from 'react'
import { useSidebarStore } from '@/stores/sidebarStore'
import { cn } from '@/lib/utils'

/**
 * Despeja el ancho del sidebar fijo en desktop. El padding izquierdo sigue el estado
 * colapsado del store. La transición se activa solo tras montar para evitar que anime
 * el "salto" en la primera carga (rehidratación de localStorage).
 */
export function SidebarOffset({ children }: { children: React.ReactNode }) {
  const collapsed = useSidebarStore((s) => s.collapsed)
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  return (
    <div
      className={cn(
        'flex flex-1 flex-col min-w-0 pt-14 md:pt-0',
        mounted && 'transition-[padding] duration-200 ease-in-out',
        collapsed ? 'md:pl-16' : 'md:pl-64'
      )}
    >
      {children}
    </div>
  )
}
