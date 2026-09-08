import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { DEFAULT_DATE_FORMAT, type DateFormat } from '@/lib/format'

interface DateFormatStore {
  dateFormat: DateFormat
  setDateFormat: (format: DateFormat) => void
}

/** Date format chosen for the Finance `date` columns (#92). */
export const useDateFormatStore = create<DateFormatStore>()(
  persist(
    (set) => ({
      dateFormat: DEFAULT_DATE_FORMAT,
      setDateFormat: (dateFormat) => set({ dateFormat }),
    }),
    { name: 'dymmsa-date-format' },
  ),
)
