'use client'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Pencil, Plus, History } from '@/components/icons'
import { useDateFormat } from '@/hooks/useDateFormat'
import { formatDuration, type WeekView } from '@/lib/timesheet'
import { formatAbsolute } from '@/lib/format'
import type { TimeEntry } from '@/types/database'
import { cn } from '@/lib/utils'

interface WeekGridProps {
  week: WeekView<TimeEntry> | undefined
  isLoading?: boolean
  isError?: boolean
  /** Admin only: shows the edit/add controls. */
  canEdit?: boolean
  onEdit?: (entry: TimeEntry) => void
  onAdd?: (date: string) => void
  /** display_name by profile id, to label who edited a pair. */
  namesById?: Record<string, string>
}

/** Seven rows, Monday to Sunday: punches per day, daily total, weekly total. */
export function WeekGrid({ week, isLoading, isError, canEdit, onEdit, onAdd, namesById = {} }: WeekGridProps) {
  const formatDate = useDateFormat()

  if (isLoading) {
    return (
      <Card>
        <CardContent className="space-y-3 pt-6">
          {Array.from({ length: 7 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
        </CardContent>
      </Card>
    )
  }
  // The API answers week: null for a range that is not a whole week; never spin forever.
  if (!week) {
    return (
      <Card>
        <CardContent className="pt-6 text-sm text-muted-foreground">
          {isError ? 'No se pudieron cargar las checadas. Intenta de nuevo.' : 'No hay una semana completa que mostrar.'}
        </CardContent>
      </Card>
    )
  }

  return (
    <TooltipProvider delayDuration={200}>
    <Card>
      <CardContent className="p-0">
        <ul className="divide-y">
          {week.days.map((day) => (
            <li key={day.date} className="grid grid-cols-[72px_1fr_auto] items-start gap-3 px-4 py-3 sm:grid-cols-[110px_1fr_90px]">
              <div>
                <p className="text-sm font-medium">{day.label}</p>
                <p className="text-xs text-muted-foreground">{formatDate(day.date)}</p>
              </div>

              <div className="space-y-1">
                {day.punches.length === 0 && (
                  <p className="text-sm text-muted-foreground/70">—</p>
                )}
                {day.punches.map(({ entry, minutes }) => (
                  <div key={entry.id} className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="tabular-nums">{entry.clock_in}</span>
                    <span className="text-muted-foreground">–</span>
                    {entry.clock_out ? (
                      <span className="tabular-nums">{entry.clock_out}</span>
                    ) : (
                      <Badge variant="outline" className="border-amber-500/60 text-amber-600 dark:text-amber-400">sin salida</Badge>
                    )}
                    {minutes != null && (
                      <span className="tabular-nums text-muted-foreground">({formatDuration(minutes)})</span>
                    )}
                    {entry.source === 'manual' && (
                      <Badge variant="secondary">manual</Badge>
                    )}
                    {entry.edited_at && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span aria-label="Editado" className="inline-flex text-muted-foreground">
                            <History className="size-3.5" />
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>
                            Editado por {(entry.edited_by && namesById[entry.edited_by]) || 'un administrador'} el {formatAbsolute(entry.edited_at)}
                          </p>
                          {entry.original && (
                            <p className="text-muted-foreground">
                              El checador decía {entry.original.clock_in}–{entry.original.clock_out ?? 'sin salida'}
                            </p>
                          )}
                        </TooltipContent>
                      </Tooltip>
                    )}
                    {entry.note && (
                      <span className="text-xs italic text-muted-foreground">{entry.note}</span>
                    )}
                    {canEdit && onEdit && (
                      <Button variant="ghost" size="icon" className="size-6" onClick={() => onEdit(entry)} aria-label="Editar checada">
                        <Pencil className="size-3.5" />
                      </Button>
                    )}
                  </div>
                ))}
                {canEdit && onAdd && (
                  <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground" onClick={() => onAdd(day.date)}>
                    <Plus className="mr-1 size-3" />
                    checada
                  </Button>
                )}
              </div>

              <p className={cn('text-right text-sm font-medium tabular-nums', day.minutes === 0 && 'text-muted-foreground/70')}>
                {formatDuration(day.minutes)}
              </p>
            </li>
          ))}
        </ul>
        <div className="flex items-center justify-between border-t bg-muted/40 px-4 py-3">
          <p className="text-sm text-muted-foreground">
            Total de la semana
            {week.open > 0 && (
              <span className="ml-2 text-amber-600 dark:text-amber-400">
                · {week.open} sin salida (no suman)
              </span>
            )}
          </p>
          <p className="text-base font-semibold tabular-nums" data-testid="week-total">{formatDuration(week.minutes)}</p>
        </div>
      </CardContent>
    </Card>
    </TooltipProvider>
  )
}
