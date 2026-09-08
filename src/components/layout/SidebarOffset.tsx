'use client'

import { useMounted } from '@/hooks/useMounted'
import { useSidebarStore } from '@/stores/sidebarStore'
import { cn } from '@/lib/utils'

/** Clears the fixed sidebar width on desktop. The transition only turns on after
 *  mount so the localStorage rehydration jump is not animated. */
export function SidebarOffset({ children }: { children: React.ReactNode }) {
  const collapsed = useSidebarStore((s) => s.collapsed)
  const mounted = useMounted()

  return (
    <div
      className={cn(
        // The sidebar is hidden when printing (#59); keeping its padding would
        // shift the content right on paper.
        'flex flex-1 flex-col min-w-0 pt-14 md:pt-0 print:pt-0! print:pl-0!',
        mounted && 'transition-[padding] duration-200 ease-in-out',
        collapsed ? 'md:pl-16' : 'md:pl-64'
      )}
    >
      {children}
    </div>
  )
}
