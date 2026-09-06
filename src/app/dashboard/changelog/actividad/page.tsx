import type { Metadata } from 'next'
import Link from 'next/link'
import { readFile, readdir } from 'fs/promises'
import { join } from 'path'
import { History } from '@/components/icons'
import { Card, CardContent } from '@/components/ui/card'
import { ChangelogTabs } from '@/components/changelog/ChangelogTabs'
import { RichText } from '@/components/changelog/RichText'
import {
  parseVaultChangelog,
  groupActivityByMonth,
  type ActivityBlock,
  type ActivityDay,
  type ActivityMonth,
} from '@/lib/vault-changelog'

export const metadata: Metadata = {
  title: 'Actividad',
  description: 'Bitácora técnica del desarrollo del sistema DYMMSA',
}

const VAULT_DIR = join(process.cwd(), 'DYMMSA', '06-Changelog')

async function readActivity(): Promise<ActivityMonth[]> {
  let files: string[]
  try {
    files = (await readdir(VAULT_DIR)).filter((f) => f.endsWith('.md'))
  } catch {
    // Si el trace de Vercel no incluyera la bóveda, la página se degrada a vacío.
    return []
  }
  const days: ActivityDay[] = []
  for (const file of files.sort().reverse()) {
    days.push(...parseVaultChangelog(await readFile(join(VAULT_DIR, file), 'utf-8')))
  }
  return groupActivityByMonth(days)
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function formatMonth(month: string): string {
  const date = new Date(`${month}-01T00:00:00`)
  return capitalize(date.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' }))
}

function formatDay(iso: string): string {
  const date = new Date(`${iso}T00:00:00`)
  return date.toLocaleDateString('es-MX', { day: 'numeric', month: 'long' })
}

/** Tinte por familia de trabajo; los módulos (Corte, Finanzas…) van neutros. */
const AREA_TINT: Record<string, string> = {
  feature: 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-300',
  fix: 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300',
  fixes: 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300',
  test: 'bg-violet-100 text-violet-800 dark:bg-violet-900/50 dark:text-violet-300',
  testing: 'bg-violet-100 text-violet-800 dark:bg-violet-900/50 dark:text-violet-300',
  refactor: 'bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300',
  migracion: 'bg-purple-100 text-purple-800 dark:bg-purple-900/50 dark:text-purple-300',
  performance: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/50 dark:text-cyan-300',
  perf: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/50 dark:text-cyan-300',
}

function areaClass(area: string): string {
  const key = area
    .split('/')[0]
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()
  return AREA_TINT[key] ?? 'border text-muted-foreground'
}

function ActivityBlockView({ block, open }: { block: ActivityBlock; open: boolean }) {
  return (
    <div className="space-y-2">
      {(block.area || block.issues.length > 0) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {block.area && (
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${areaClass(block.area)}`}>
              {block.area}
            </span>
          )}
          {block.issues.map((issue) => (
            <Link
              key={issue}
              href={`/dashboard/tasks/${issue}`}
              className="rounded-full border px-2 py-0.5 text-xs font-medium text-primary hover:underline"
            >
              #{issue}
            </Link>
          ))}
        </div>
      )}

      <p className="text-sm text-muted-foreground">
        <RichText text={block.title} />
      </p>

      {block.details.length > 0 && (
        <details open={open} className="group">
          <summary className="inline-flex cursor-pointer list-none text-xs font-medium text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
            <span className="group-open:hidden">Ver detalle ({block.details.length})</span>
            <span className="hidden group-open:inline">Ocultar detalle</span>
          </summary>
          <ul className="mt-2 ml-1 space-y-1.5">
            {block.details.map((detail, i) => (
              <li key={i} className="flex gap-2 text-sm text-muted-foreground">
                <span className="mt-2 size-1 shrink-0 rounded-full bg-muted-foreground/40" />
                <span>
                  <RichText text={detail} />
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {block.motivo && (
        <p className="rounded-md border-l-2 border-primary/40 bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Motivo: </span>
          <RichText text={block.motivo} />
        </p>
      )}
    </div>
  )
}

export default async function ActivityPage() {
  const months = await readActivity()
  const totalDays = months.reduce((n, m) => n + m.days.length, 0)
  const totalBlocks = months.reduce(
    (n, m) => n + m.days.reduce((acc, day) => acc + day.blocks.length, 0),
    0,
  )

  return (
    <div className="docs-page-bg -mx-4 -my-8 px-4 py-8">
      <div className="mx-auto max-w-3xl space-y-8">
        <div>
          <h1 className="flex items-center gap-3 text-3xl font-semibold tracking-tight">
            <History className="size-8" />
            Actividad
          </h1>
          <p className="mt-2 text-muted-foreground">
            Bitácora técnica del desarrollo: qué se trabajó cada día y por qué. El resumen
            en lenguaje llano vive en Novedades.
          </p>
          <div className="mt-4">
            <ChangelogTabs active="actividad" />
          </div>
          {totalDays > 0 && (
            <p className="mt-4 text-xs text-muted-foreground">
              {totalBlocks} entradas en {totalDays} días de trabajo · desde{' '}
              {formatMonth(months[months.length - 1].month)}
            </p>
          )}
        </div>

        {months.length === 0 ? (
          <div className="login-card-border">
            <Card className="docs-card-inner border-0">
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                Aún no hay actividad registrada.
              </CardContent>
            </Card>
          </div>
        ) : (
          months.map((month, monthIndex) => (
            <section key={month.month} className="space-y-4">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {formatMonth(month.month)}
              </h2>

              <div className="space-y-0">
                {month.days.map((day, dayIndex) => (
                  <div key={`${day.date}-${dayIndex}`} className="flex gap-4">
                    <div className="flex flex-col items-center">
                      <div className="size-3 shrink-0 rounded-full bg-primary ring-4 ring-primary/15" />
                      {dayIndex < month.days.length - 1 && (
                        <div className="w-px flex-1 bg-border" />
                      )}
                    </div>

                    <div className="min-w-0 flex-1 pb-8">
                      <div className="mb-3 flex flex-wrap items-center gap-2">
                        <h3 className="text-base font-semibold leading-none">
                          {capitalize(formatDay(day.date))}
                        </h3>
                        {day.label && (
                          <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
                            {day.label}
                          </span>
                        )}
                        {day.total && (
                          <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
                            {day.total}
                          </span>
                        )}
                      </div>

                      <div className="login-card-border">
                        <Card className="docs-card-inner border-0">
                          <CardContent className="space-y-4 py-4">
                            {day.blocks.map((block, i) => (
                              <div key={i} className={i > 0 ? 'border-t pt-4' : undefined}>
                                <ActivityBlockView block={block} open={monthIndex === 0} />
                              </div>
                            ))}
                          </CardContent>
                        </Card>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))
        )}
      </div>
    </div>
  )
}
