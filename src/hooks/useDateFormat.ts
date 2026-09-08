'use client'

import { useDateFormatStore } from '@/stores/dateFormatStore'
import { useMounted } from '@/hooks/useMounted'
import { DEFAULT_DATE_FORMAT, formatDay } from '@/lib/format'

/** Formats `date` columns with the user's preference; default until hydrated. */
export function useDateFormat() {
  const stored = useDateFormatStore((s) => s.dateFormat)
  const mounted = useMounted()
  const dateFormat = mounted ? stored : DEFAULT_DATE_FORMAT
  return (iso: string): string => formatDay(iso, dateFormat)
}
