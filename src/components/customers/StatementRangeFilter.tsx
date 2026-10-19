'use client'

import { useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { RotateCcw } from '@/components/icons'
import { todayInMexico } from '@/lib/format'
import { isRealDate } from '@/lib/month'
import {
  defaultStatementRange,
  parseStatementRange,
  rangeQuery,
  STATEMENT_FILTER_LABELS,
  STATEMENT_FILTERS,
  type StatementFilter,
  type StatementRange,
} from '@/lib/customers'

/** The window lives in the URL: the list and the detail share it, and a link reopens the same view. */
export function useStatementRange(): [StatementRange, (next: StatementRange) => void] {
  const searchParams = useSearchParams()
  const { replace } = useRouter()
  const pathname = usePathname()
  const today = todayInMexico()
  const parsed = parseStatementRange(new URLSearchParams(searchParams.toString()), today)
  const range = parsed.ok ? parsed.range : defaultStatementRange(today)
  return [range, (next) => replace(`${pathname}?${rangeQuery(next)}`, { scroll: false })]
}

const DATE_INPUT =
  'rounded-lg border bg-background px-2.5 py-1.5 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-ring'

// Typing a year goes through 0002, 0020, 0202…: only a plausible date reaches the URL.
const committable = (value: string) => value === '' || (isRealDate(value) && value >= '2000-01-01')

/** Due-date window and which invoices to show. The inputs keep a draft, so typing never fights the URL. */
export function StatementRangeFilter({ range, onChange }: { range: StatementRange; onChange: (next: StatementRange) => void }) {
  const [draft, setDraft] = useState({ from: range.from ?? '', to: range.to ?? '' })
  const [synced, setSynced] = useState(range)
  // A new range from the URL (reset, back button) replaces the draft: state adjusted during render, no effect.
  if (synced.from !== range.from || synced.to !== range.to) {
    setSynced(range)
    setDraft({ from: range.from ?? '', to: range.to ?? '' })
  }
  const inverted = !!draft.from && !!draft.to && committable(draft.from) && committable(draft.to) && draft.from > draft.to

  const setBound = (key: 'from' | 'to', value: string) => {
    const next = { ...draft, [key]: value }
    setDraft(next)
    if (!committable(next.from) || !committable(next.to)) return
    if (next.from && next.to && next.from > next.to) return
    onChange({ ...range, from: next.from || null, to: next.to || null })
  }

  return (
    <div className="flex flex-wrap items-end gap-3 print:hidden" data-tour="cli-range">
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        Vence desde
        <input
          type="date"
          aria-label="Vence desde"
          value={draft.from}
          max={draft.to || undefined}
          aria-invalid={inverted || undefined}
          onChange={(e) => setBound('from', e.target.value)}
          className={DATE_INPUT}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        Vence hasta
        <input
          type="date"
          aria-label="Vence hasta"
          value={draft.to}
          min={draft.from || undefined}
          aria-invalid={inverted || undefined}
          onChange={(e) => setBound('to', e.target.value)}
          className={DATE_INPUT}
        />
      </label>
      <Select value={range.filter} onValueChange={(value) => onChange({ ...range, filter: value as StatementFilter })}>
        <SelectTrigger className="w-auto min-w-[190px]" aria-label="Qué facturas mostrar">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {STATEMENT_FILTERS.map((f) => (
            <SelectItem key={f} value={f}>{STATEMENT_FILTER_LABELS[f]}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button variant="ghost" size="sm" onClick={() => onChange(defaultStatementRange(todayInMexico()))}>
        <RotateCcw className="mr-1 size-3.5" />
        Todo lo vencido + este mes
      </Button>
      {inverted && (
        <p role="alert" className="basis-full text-xs text-destructive">
          La fecha &ldquo;desde&rdquo; no puede ser posterior a &ldquo;hasta&rdquo;: el rango no cambió.
        </p>
      )}
    </div>
  )
}
