import type { TaskPriority, TaskState, TaskCloseReason } from '@/lib/github'

export const PRIORITY_META: Record<TaskPriority, { label: string; badge: string; dot: string }> = {
  low: {
    label: 'Baja',
    badge: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
    dot: 'bg-slate-400',
  },
  medium: {
    label: 'Media',
    badge: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/50 dark:text-yellow-300',
    dot: 'bg-yellow-500',
  },
  high: {
    label: 'Alta',
    badge: 'bg-orange-100 text-orange-800 dark:bg-orange-900/50 dark:text-orange-300',
    dot: 'bg-orange-500',
  },
  highest: {
    label: 'Máxima',
    badge: 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-300',
    dot: 'bg-red-500',
  },
}

/** Orden de mayor a menor prioridad (para selects y ordenamiento). */
export const PRIORITY_ORDER: TaskPriority[] = ['highest', 'high', 'medium', 'low']

/** Badge de estado: Abierta / Cerrada (completada) / Descartada (not_planned). */
export function TaskStateBadge({ state, closedReason }: { state: TaskState; closedReason: TaskCloseReason | null }) {
  const meta =
    state === 'open'
      ? { label: 'Abierta', cls: 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-300' }
      : closedReason === 'not_planned'
        ? { label: 'Descartada', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300' }
        : { label: 'Cerrada', cls: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400' }
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${meta.cls}`}>{meta.label}</span>
}

export function TaskPriorityBadge({ priority }: { priority: TaskPriority | null }) {
  if (!priority) {
    return <span className="text-xs text-muted-foreground">—</span>
  }
  const meta = PRIORITY_META[priority]
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${meta.badge}`}>
      <span className={`size-1.5 rounded-full ${meta.dot}`} />
      {meta.label}
    </span>
  )
}
