'use client'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useDateFormatStore } from '@/stores/dateFormatStore'
import { useMounted } from '@/hooks/useMounted'
import { DATE_FORMATS, DEFAULT_DATE_FORMAT, formatDay, isDateFormat } from '@/lib/format'

/** Sample date: the user picks by how it looks, not by a technical name. */
const SAMPLE = '2026-09-15'

export function DateFormatPicker() {
  const stored = useDateFormatStore((s) => s.dateFormat)
  const setDateFormat = useDateFormatStore((s) => s.setDateFormat)
  const mounted = useMounted()
  const value = mounted ? stored : DEFAULT_DATE_FORMAT

  return (
    <Select value={value} onValueChange={(v) => { if (isDateFormat(v)) setDateFormat(v) }}>
      <SelectTrigger className="w-auto min-w-[170px]" aria-label="Formato de fecha">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {DATE_FORMATS.map((f) => (
          <SelectItem key={f} value={f}>{formatDay(SAMPLE, f)}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
