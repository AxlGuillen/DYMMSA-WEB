'use client'

import { useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Loader2, Plus } from '@/components/icons'
import { useCreateTask, useUploadTaskImage } from '@/hooks/useTasks'
import { compressImage } from '@/lib/image-compress'
import { PRIORITY_META, PRIORITY_ORDER } from './TaskPriorityBadge'
import type { TaskPriority } from '@/lib/github'

const NO_PRIORITY = 'none'

export function TaskForm({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const createTask = useCreateTask()
  const uploadImage = useUploadTaskImage()
  const fileRef = useRef<HTMLInputElement>(null)

  const [title, setTitle] = useState('')
  const [priority, setPriority] = useState<string>(NO_PRIORITY)
  const [description, setDescription] = useState('')

  function reset() {
    setTitle('')
    setPriority(NO_PRIORITY)
    setDescription('')
  }

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return
    for (const file of Array.from(files)) {
      try {
        const optimized = await compressImage(file) // reduce dimensiones + WebP antes de subir
        const { url } = await uploadImage.mutateAsync(optimized)
        // Embebe la imagen al final de la descripción (markdown que GitHub renderiza).
        setDescription((prev) => `${prev}${prev && !prev.endsWith('\n') ? '\n\n' : ''}![${file.name}](${url})\n`)
      } catch (e) {
        toast.error('No se pudo subir la imagen', { description: e instanceof Error ? e.message : undefined })
      }
    }
    if (fileRef.current) fileRef.current.value = ''
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    try {
      await createTask.mutateAsync({
        title: title.trim(),
        description: description.trim() || undefined,
        priority: priority === NO_PRIORITY ? undefined : (priority as TaskPriority),
      })
      toast.success('Tarea creada')
      reset()
      onOpenChange(false)
    } catch (err) {
      toast.error('Error al crear la tarea', { description: err instanceof Error ? err.message : undefined })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Nueva tarea</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="task-title">Título</Label>
            <Input
              id="task-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ej: El total no suma bien"
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="task-priority">Prioridad</Label>
            <Select value={priority} onValueChange={setPriority}>
              <SelectTrigger id="task-priority">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_PRIORITY}>Sin prioridad</SelectItem>
                {PRIORITY_ORDER.map((p) => (
                  <SelectItem key={p} value={p}>{PRIORITY_META[p].label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="task-desc">Descripción</Label>
            <textarea
              id="task-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={6}
              placeholder="Describe la tarea. Puedes adjuntar imágenes abajo."
              className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            <div className="flex items-center gap-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/gif,image/webp"
                multiple
                className="hidden"
                onChange={(e) => handleFiles(e.target.files)}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileRef.current?.click()}
                disabled={uploadImage.isPending}
              >
                {uploadImage.isPending
                  ? <><Loader2 className="mr-2 size-3.5 animate-spin" /> Subiendo…</>
                  : <><Plus className="mr-2 size-3.5" /> Adjuntar imagen</>}
              </Button>
              <span className="text-xs text-muted-foreground">PNG, JPG, GIF o WEBP · máx 5 MB</span>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" disabled={createTask.isPending || !title.trim()}>
              {createTask.isPending ? <><Loader2 className="mr-2 size-4 animate-spin" /> Creando…</> : 'Crear tarea'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
