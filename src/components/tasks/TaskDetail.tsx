'use client'

import { useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import {
  ArrowLeft, ExternalLink, Loader2, AlertCircle, Pencil, CheckCircle2, RotateCcw, Send, Ban,
} from '@/components/icons'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { useTask, useUpdateTask, useCreateComment } from '@/hooks/useTasks'
import { TaskPriorityBadge, TaskStateBadge, PRIORITY_META, PRIORITY_ORDER } from './TaskPriorityBadge'
import type { TaskPriority } from '@/lib/github'

const NO_PRIORITY = 'none'
const IMG_RE = /!\[[^\]]*\]\(([^)]+)\)/

/** Render mínimo del body: imágenes markdown como <img>, el resto como texto. */
function TaskBody({ text }: { text: string }) {
  if (!text.trim()) return <p className="text-sm italic text-muted-foreground">Sin descripción.</p>
  const blocks = text.split(/\n{2,}/)
  return (
    <div className="space-y-3">
      {blocks.map((block, i) => {
        const m = block.match(IMG_RE)
        if (m) {
          // eslint-disable-next-line @next/next/no-img-element
          return <img key={i} src={m[1]} alt="" className="max-w-full rounded-md border" />
        }
        return <p key={i} className="whitespace-pre-wrap text-sm leading-relaxed">{block}</p>
      })}
    </div>
  )
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('es-MX', {
    day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

export function TaskDetail({ number }: { number: number }) {
  const { data, isLoading, error } = useTask(number)
  const updateTask = useUpdateTask(number)
  const createComment = useCreateComment(number)

  const [editing, setEditing] = useState(false)
  const [editTitle, setEditTitle] = useState('')
  const [editDesc, setEditDesc] = useState('')
  const [comment, setComment] = useState('')

  if (isLoading) {
    return <div className="flex items-center justify-center py-20 text-muted-foreground"><Loader2 className="mr-2 size-5 animate-spin" /> Cargando…</div>
  }
  if (error || !data) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 py-16 text-center">
        <AlertCircle className="size-8 text-destructive" />
        <p className="font-medium text-destructive">No se pudo cargar la tarea</p>
        <p className="max-w-md text-sm text-muted-foreground">{error instanceof Error ? error.message : 'Error desconocido'}</p>
        <Link href="/dashboard/tasks" className="mt-2 text-sm underline">Volver a tareas</Link>
      </div>
    )
  }

  const { task, comments } = data
  const isOpen = task.state === 'open'

  async function run(fn: () => Promise<unknown>, ok: string) {
    try { await fn(); toast.success(ok) }
    catch (e) { toast.error('Error', { description: e instanceof Error ? e.message : undefined }) }
  }

  function startEdit() {
    setEditTitle(task.title)
    setEditDesc(task.description)
    setEditing(true)
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link href="/dashboard/tasks" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Tareas
      </Link>

      {/* Encabezado */}
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-4">
          {editing ? (
            <Input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} className="text-lg font-semibold" />
          ) : (
            <h1 className="text-2xl font-semibold tracking-tight">
              {task.title} <span className="font-mono text-lg text-muted-foreground">#{task.number}</span>
            </h1>
          )}
          <a href={task.url} target="_blank" rel="noopener noreferrer" className="shrink-0 text-muted-foreground hover:text-foreground" title="Ver en GitHub">
            <ExternalLink className="size-4" />
          </a>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
          <TaskStateBadge state={task.state} closedReason={task.closedReason} />
          <TaskPriorityBadge priority={task.priority} />
          {task.reporter && <span>Reportó: <strong className="text-foreground">{task.reporter}</strong></span>}
          <span>Creada el {formatDateTime(task.createdAt)}</span>
        </div>
      </div>

      {/* Acciones */}
      <div className="flex flex-wrap items-center gap-2 border-y py-3">
        <Select
          value={task.priority ?? NO_PRIORITY}
          onValueChange={(v) => run(() => updateTask.mutateAsync({ priority: v === NO_PRIORITY ? null : (v as TaskPriority) }), 'Prioridad actualizada')}
        >
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_PRIORITY}>Sin prioridad</SelectItem>
            {PRIORITY_ORDER.map((p) => <SelectItem key={p} value={p}>{PRIORITY_META[p].label}</SelectItem>)}
          </SelectContent>
        </Select>

        {isOpen ? (
          <>
            <Button variant="outline" size="sm" disabled={updateTask.isPending}
              onClick={() => run(() => updateTask.mutateAsync({ state: 'closed', stateReason: 'completed' }), 'Tarea cerrada')}>
              <CheckCircle2 className="mr-2 size-4" /> Cerrar
            </Button>
            <Button variant="outline" size="sm" disabled={updateTask.isPending}
              className="text-amber-700 hover:text-amber-800 dark:text-amber-400"
              onClick={() => run(() => updateTask.mutateAsync({ state: 'closed', stateReason: 'not_planned' }), 'Tarea descartada')}>
              <Ban className="mr-2 size-4" /> Descartar
            </Button>
          </>
        ) : (
          <Button variant="outline" size="sm" disabled={updateTask.isPending}
            onClick={() => run(() => updateTask.mutateAsync({ state: 'open' }), 'Tarea reabierta')}>
            <RotateCcw className="mr-2 size-4" /> Reabrir
          </Button>
        )}

        {!editing && (
          <Button variant="ghost" size="sm" onClick={startEdit}>
            <Pencil className="mr-2 size-4" /> Editar
          </Button>
        )}
      </div>

      {/* Descripción */}
      {editing ? (
        <div className="space-y-2">
          <textarea
            value={editDesc}
            onChange={(e) => setEditDesc(e.target.value)}
            rows={8}
            className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          <div className="flex gap-2">
            <Button size="sm" disabled={updateTask.isPending || !editTitle.trim()}
              onClick={() => run(async () => { await updateTask.mutateAsync({ title: editTitle.trim(), description: editDesc }); setEditing(false) }, 'Tarea actualizada')}>
              {updateTask.isPending ? <Loader2 className="mr-2 size-4 animate-spin" /> : null} Guardar
            </Button>
            <Button size="sm" variant="outline" onClick={() => setEditing(false)}>Cancelar</Button>
          </div>
        </div>
      ) : (
        <TaskBody text={task.description} />
      )}

      {/* Comentarios */}
      <div className="space-y-4 border-t pt-6">
        <h2 className="font-medium">Comentarios {comments.length > 0 && <span className="text-muted-foreground">({comments.length})</span>}</h2>
        {comments.length === 0 ? (
          <p className="text-sm italic text-muted-foreground">Aún no hay comentarios.</p>
        ) : (
          <div className="space-y-3">
            {comments.map((c) => (
              <div key={c.id} className="rounded-md border px-4 py-3">
                <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                  <strong className="text-foreground">{c.reporter ?? c.author}</strong>
                  <span>·</span>
                  <span>{formatDateTime(c.createdAt)}</span>
                </div>
                <TaskBody text={c.body} />
              </div>
            ))}
          </div>
        )}

        <div className="space-y-2">
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={3}
            placeholder="Escribe un comentario…"
            className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          <Button
            size="sm"
            disabled={createComment.isPending || !comment.trim()}
            onClick={() => run(async () => { await createComment.mutateAsync(comment.trim()); setComment('') }, 'Comentario agregado')}
          >
            {createComment.isPending ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Send className="mr-2 size-4" />}
            Comentar
          </Button>
        </div>
      </div>
    </div>
  )
}
