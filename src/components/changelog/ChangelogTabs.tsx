import Link from 'next/link'
import { Sparkles, History } from '@/components/icons'

/** Two routes, not stateful tabs: both stay server-side so the 108 KB technical
 *  log never ships to the client. */

const TABS = [
  { key: 'novedades', href: '/dashboard/changelog', label: 'Novedades', icon: Sparkles },
  { key: 'actividad', href: '/dashboard/changelog/actividad', label: 'Actividad', icon: History },
] as const

export function ChangelogTabs({ active }: { active: 'novedades' | 'actividad' }) {
  return (
    <nav
      aria-label="Vistas del registro de cambios"
      className="inline-flex items-center gap-1 rounded-lg border bg-muted/40 p-1"
    >
      {TABS.map((tab) => {
        const isActive = tab.key === active
        const Icon = tab.icon
        return (
          <Link
            key={tab.key}
            href={tab.href}
            aria-current={isActive ? 'page' : undefined}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors ${
              isActive
                ? 'bg-background font-medium text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Icon className="size-4" />
            {tab.label}
          </Link>
        )
      })}
    </nav>
  )
}
