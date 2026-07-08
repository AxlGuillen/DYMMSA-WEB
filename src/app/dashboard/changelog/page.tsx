import type { Metadata } from 'next'
import { readFile } from 'fs/promises'
import { join } from 'path'
import { Sparkles, Plus, ArrowUp, Wrench } from '@/components/icons'
import { Card, CardContent } from '@/components/ui/card'
import { parseChangelog, type ChangelogCategory } from '@/lib/changelog'

export const metadata: Metadata = {
  title: 'Novedades',
  description: 'Registro de mejoras y correcciones del sistema DYMMSA',
}

const CATEGORY_META: Record<
  ChangelogCategory,
  { label: string; badge: string; icon: typeof Plus }
> = {
  nuevo: {
    label: 'Nuevo',
    badge: 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-300',
    icon: Plus,
  },
  mejorado: {
    label: 'Mejorado',
    badge: 'bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300',
    icon: ArrowUp,
  },
  corregido: {
    label: 'Corregido',
    badge: 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300',
    icon: Wrench,
  },
}

const CATEGORY_ORDER: ChangelogCategory[] = ['nuevo', 'mejorado', 'corregido']

function formatDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00`)
  const label = date.toLocaleDateString('es-MX', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  })
  return label.charAt(0).toUpperCase() + label.slice(1)
}

export default async function ChangelogPage() {
  const raw = await readFile(join(process.cwd(), 'CHANGELOG.md'), 'utf-8')
  const releases = parseChangelog(raw)

  return (
    <div className="docs-page-bg -mx-4 -my-8 px-4 py-8">
      <div className="mx-auto max-w-3xl space-y-8">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight flex items-center gap-3">
            <Sparkles className="size-8" />
            Novedades
          </h1>
          <p className="mt-2 text-muted-foreground">
            Mejoras y correcciones del sistema, de lo más reciente a lo más antiguo.
          </p>
        </div>

        {releases.length === 0 ? (
          <div className="login-card-border">
            <Card className="docs-card-inner border-0">
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                Aún no hay novedades registradas.
              </CardContent>
            </Card>
          </div>
        ) : (
          <div className="space-y-0">
            {releases.map((release, i) => (
              <div key={`${release.date}-${i}`} className="flex gap-4">
                {/* Timeline marker + connector */}
                <div className="flex flex-col items-center">
                  <div className="size-3 shrink-0 rounded-full bg-primary ring-4 ring-primary/15" />
                  {i < releases.length - 1 && (
                    <div className="w-px flex-1 bg-border" />
                  )}
                </div>

                {/* Release content */}
                <div className="flex-1 min-w-0 pb-8">
                  <div className="mb-3 flex items-center gap-2">
                    <h2 className="text-base font-semibold leading-none">
                      {formatDate(release.date)}
                    </h2>
                    {release.version && (
                      <span className="rounded-full border px-2 py-0.5 text-xs font-medium text-muted-foreground">
                        {release.version}
                      </span>
                    )}
                  </div>

                  <div className="login-card-border">
                    <Card className="docs-card-inner border-0">
                      <CardContent className="space-y-4 py-4">
                        {CATEGORY_ORDER.map((cat) => {
                          const items = release.entries.filter((e) => e.category === cat)
                          if (items.length === 0) return null
                          const meta = CATEGORY_META[cat]
                          const Icon = meta.icon
                          return (
                            <div key={cat} className="space-y-2">
                              <span
                                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${meta.badge}`}
                              >
                                <Icon className="size-3" />
                                {meta.label}
                              </span>
                              <ul className="ml-1 space-y-1.5">
                                {items.map((entry, j) => (
                                  <li
                                    key={j}
                                    className="flex gap-2 text-sm text-muted-foreground"
                                  >
                                    <span className="mt-2 size-1 shrink-0 rounded-full bg-muted-foreground/40" />
                                    <span>{entry.text}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )
                        })}
                      </CardContent>
                    </Card>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
