'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ClipboardList, Plus, Loader2, AlertCircle } from '@/components/icons'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useTasks, type TaskStateFilter, type TaskPriorityFilter } from '@/hooks/useTasks'
import { TaskForm } from '@/components/tasks/TaskForm'
import { TaskPriorityBadge, TaskStateBadge, PRIORITY_META, PRIORITY_ORDER } from '@/components/tasks/TaskPriorityBadge'

const STATE_TABS: { value: TaskStateFilter; label: string }[] = [
  { value: 'open', label: 'Abiertas' },
  { value: 'closed', label: 'Cerradas' },
  { value: 'all', label: 'Todas' },
]

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default function TasksPage() {
  const [state, setState] = useState<TaskStateFilter>('open')
  const [priority, setPriority] = useState<TaskPriorityFilter>('all')
  const [formOpen, setFormOpen] = useState(false)

  const { data, isLoading, error } = useTasks({ state, priority })
  const tasks = data?.tasks ?? []

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <ClipboardList className="size-6" />
            Tareas
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Planeadas y en curso, sincronizadas con GitHub. Las cerradas son el histórico.
          </p>
        </div>
        <Button onClick={() => setFormOpen(true)}>
          <Plus className="mr-2 size-4" /> Nueva tarea
        </Button>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="inline-flex rounded-lg border p-0.5">
          {STATE_TABS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setState(tab.value)}
              className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${
                state === tab.value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => setPriority('all')}
            className={`rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors ${
              priority === 'all' ? 'bg-accent' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Toda prioridad
          </button>
          {PRIORITY_ORDER.map((p) => (
            <button
              key={p}
              onClick={() => setPriority(p)}
              className={`rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors ${
                priority === p ? PRIORITY_META[p].badge : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {PRIORITY_META[p].label}
            </button>
          ))}
        </div>
      </div>

      {/* Contenido */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="mr-2 size-5 animate-spin" /> Cargando tareas…
        </div>
      ) : error ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 py-12 text-center">
          <AlertCircle className="size-8 text-destructive" />
          <p className="font-medium text-destructive">No se pudieron cargar las tareas</p>
          <p className="max-w-md text-sm text-muted-foreground">{error instanceof Error ? error.message : 'Error desconocido'}</p>
        </div>
      ) : tasks.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border py-16 text-center">
          <ClipboardList className="size-10 text-muted-foreground/40" />
          <p className="font-medium text-muted-foreground">No hay tareas {state === 'closed' ? 'cerradas' : state === 'open' ? 'abiertas' : ''}</p>
          <Button className="mt-2" size="sm" onClick={() => setFormOpen(true)}>
            <Plus className="mr-2 size-4" /> Crear la primera
          </Button>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">#</TableHead>
                <TableHead>Título</TableHead>
                <TableHead className="w-32">Prioridad</TableHead>
                <TableHead className="w-24">Estado</TableHead>
                <TableHead className="w-40">Reportó</TableHead>
                <TableHead className="w-28">Creada</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tasks.map((t) => (
                <TableRow key={t.number} className="cursor-pointer">
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    <Link href={`/dashboard/tasks/${t.number}`} className="block">#{t.number}</Link>
                  </TableCell>
                  <TableCell>
                    <Link href={`/dashboard/tasks/${t.number}`} className="block font-medium hover:underline">
                      {t.title}
                    </Link>
                  </TableCell>
                  <TableCell><TaskPriorityBadge priority={t.priority} /></TableCell>
                  <TableCell>
                    <TaskStateBadge state={t.state} closedReason={t.closedReason} />
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground truncate max-w-40">{t.reporter ?? '—'}</TableCell>
                  <TableCell className="text-sm text-muted-foreground whitespace-nowrap">{formatDate(t.createdAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <TaskForm open={formOpen} onOpenChange={setFormOpen} />
    </div>
  )
}
