'use client'

import { ChevronDown } from '@/components/icons'
import { useMounted } from '@/hooks/useMounted'
import { useCollapsedSectionsStore } from '@/stores/collapsedSectionsStore'
import { cn } from '@/lib/utils'

/** Collapsed only after mount: the server always renders it open, so hydration never disagrees. */
export function useCollapsed(id: string): boolean {
  const mounted = useMounted()
  const collapsed = useCollapsedSectionsStore((s) => !!s.collapsed[id])
  return mounted && collapsed
}

export function CollapseToggle({ id, children, className }: { id: string; children: React.ReactNode; className?: string }) {
  const collapsed = useCollapsed(id)
  const toggle = useCollapsedSectionsStore((s) => s.toggle)
  return (
    <button
      type="button"
      onClick={() => toggle(id)}
      aria-expanded={!collapsed}
      className={cn('flex items-center gap-2 text-left hover:text-foreground', className)}
    >
      <ChevronDown className={cn('size-4 shrink-0 transition-transform', collapsed && '-rotate-90')} />
      {children}
    </button>
  )
}
