'use client'

import { useMounted } from '@/hooks/useMounted'
import { useSidebarStore } from '@/stores/sidebarStore'
import { cn } from '@/lib/utils'

/**
 * Despeja el ancho del sidebar fijo en desktop. El padding izquierdo sigue el estado
 * colapsado del store. La transición se activa solo tras montar para evitar que anime
 * el "salto" en la primera carga (rehidratación de localStorage).
 */
export function SidebarOffset({ children }: { children: React.ReactNode }) {
  const collapsed = useSidebarStore((s) => s.collapsed)
  const mounted = useMounted()

  return (
    <div
      className={cn(
        // print: el sidebar va oculto al imprimir (diagramas de corte para el
        // taller, issue #59) — sin quitar su padding, el contenido saldría
        // desplazado hacia la derecha en el papel.
        'flex flex-1 flex-col min-w-0 pt-14 md:pt-0 print:pt-0! print:pl-0!',
        mounted && 'transition-[padding] duration-200 ease-in-out',
        collapsed ? 'md:pl-16' : 'md:pl-64'
      )}
    >
      {children}
    </div>
  )
}
