import Link from 'next/link'
import { BookOpen, Play } from '@/components/icons'

/** Two routes, same pattern as ChangelogTabs: the docs stay one long page, the videos get their own. */

const TABS = [
  { key: 'documentacion', href: '/dashboard/docs', label: 'Documentación', icon: BookOpen },
  { key: 'tutoriales', href: '/dashboard/docs/tutoriales', label: 'Tutoriales', icon: Play },
] as const

export type DocsTab = (typeof TABS)[number]['key']

export function DocsTabs({ active }: { active: DocsTab }) {
  return (
    <nav aria-label="Vistas de la documentación" className="inline-flex items-center gap-1 rounded-lg border bg-muted/40 p-1">
      {TABS.map((tab) => {
        const isActive = tab.key === active
        const Icon = tab.icon
        return (
          <Link
            key={tab.key}
            href={tab.href}
            aria-current={isActive ? 'page' : undefined}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors ${
              isActive ? 'bg-background font-medium text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
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
