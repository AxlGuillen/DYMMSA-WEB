'use client'

import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ChevronLeft, ChevronRight } from '@/components/icons'
import { DateFormatPicker } from '@/components/finance/DateFormatPicker'
import { WeekGrid } from '@/components/hours/WeekGrid'
import { TimeEntryForm } from '@/components/hours/TimeEntryForm'
import { useProfile, useProfiles } from '@/hooks/useProfile'
import { useTimeEntries } from '@/hooks/useTimeEntries'
import { useDateFormat } from '@/hooks/useDateFormat'
import { todayInMexico } from '@/lib/format'
import { shiftWeek, weekBounds } from '@/lib/timesheet'
import type { TimeEntry } from '@/types/database'

/** Week stepper + (admin) employee selector + the grid. */
export function HoursView() {
  const { profile, isAdmin } = useProfile()
  const { data: profiles } = useProfiles(isAdmin)
  const formatDate = useDateFormat()

  const thisWeek = weekBounds(todayInMexico()).start
  const [weekStart, setWeekStart] = useState(thisWeek)
  const [selectedUser, setSelectedUser] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<TimeEntry | null>(null)
  const [addDate, setAddDate] = useState<string | undefined>()

  const targetUser = isAdmin ? (selectedUser ?? profile?.id ?? null) : null
  const { start, end } = weekBounds(weekStart)
  const { data, isLoading } = useTimeEntries({ user: targetUser, from: start, to: end })

  const namesById = useMemo(
    () => Object.fromEntries((profiles ?? []).map((p) => [p.id, p.display_name])),
    [profiles],
  )

  const openEdit = (entry: TimeEntry) => { setEditing(entry); setAddDate(undefined); setFormOpen(true) }
  const openAdd = (date: string) => { setEditing(null); setAddDate(date); setFormOpen(true) }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="icon" className="size-8" onClick={() => setWeekStart((w) => shiftWeek(w, -1))} aria-label="Semana anterior">
          <ChevronLeft className="size-4" />
        </Button>
        <span className="min-w-[220px] text-center text-sm font-medium">
          {formatDate(start)} – {formatDate(end)}
        </span>
        <Button variant="outline" size="icon" className="size-8" onClick={() => setWeekStart((w) => shiftWeek(w, 1))} aria-label="Semana siguiente">
          <ChevronRight className="size-4" />
        </Button>
        {weekStart !== thisWeek && (
          <Button variant="ghost" size="sm" onClick={() => setWeekStart(thisWeek)}>Esta semana</Button>
        )}

        <div className="ml-auto flex items-center gap-2">
          {isAdmin && profiles && (
            <Select value={targetUser ?? ''} onValueChange={setSelectedUser}>
              <SelectTrigger className="w-auto min-w-[180px]" aria-label="Empleado">
                <SelectValue placeholder="Empleado" />
              </SelectTrigger>
              <SelectContent>
                {profiles.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.display_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <DateFormatPicker />
        </div>
      </div>

      <WeekGrid
        week={data?.week ?? undefined}
        isLoading={isLoading}
        canEdit={isAdmin}
        onEdit={openEdit}
        onAdd={openAdd}
        namesById={namesById}
      />

      {isAdmin && targetUser && (
        <TimeEntryForm open={formOpen} onOpenChange={setFormOpen} entry={editing} userId={targetUser} date={addDate} />
      )}
    </div>
  )
}
