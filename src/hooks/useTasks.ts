'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchJson } from '@/lib/fetch-json'
import type { Task, TaskComment, TaskPriority, TaskState } from '@/lib/github'

const TASKS_KEY = ['tasks']
const JSON_HEADERS = { 'Content-Type': 'application/json' }

export type TaskStateFilter = 'open' | 'closed' | 'all'
export type TaskPriorityFilter = TaskPriority | 'all'

interface TasksParams {
  state?: TaskStateFilter
  priority?: TaskPriorityFilter
  page?: number
}

export function useTasks(params: TasksParams = {}) {
  const { state = 'open', priority = 'all', page = 1 } = params
  return useQuery({
    queryKey: [...TASKS_KEY, 'list', { state, priority, page }],
    queryFn: () => {
      const qs = new URLSearchParams({ state, page: String(page) })
      if (priority !== 'all') qs.set('priority', priority)
      return fetchJson<{ tasks: Task[]; page: number }>(`/api/tasks?${qs.toString()}`)
    },
  })
}

export function useTask(number: number) {
  return useQuery({
    queryKey: [...TASKS_KEY, 'detail', number],
    enabled: Number.isInteger(number) && number > 0,
    queryFn: () => fetchJson<{ task: Task; comments: TaskComment[] }>(`/api/tasks/${number}`),
  })
}

export function useCreateTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { title: string; description?: string; priority?: TaskPriority }) =>
      fetchJson<Task>('/api/tasks', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(input) }),
    onSuccess: (newTask) => {
      // Optimistic insert into the lists whose filters match, before the refetch.
      const lists = qc.getQueriesData<{ tasks: Task[]; page: number }>({ queryKey: [...TASKS_KEY, 'list'] })
      for (const [key, data] of lists) {
        if (!data) continue
        const f = (key[key.length - 1] ?? {}) as { state?: string; priority?: string; page?: number }
        const matches =
          (!f.state || f.state === 'all' || f.state === newTask.state) &&
          (!f.priority || f.priority === 'all' || f.priority === newTask.priority) &&
          (!f.page || f.page === 1)
        if (matches && !data.tasks.some((t) => t.number === newTask.number)) {
          qc.setQueryData(key, { ...data, tasks: [newTask, ...data.tasks] })
        }
      }
      // Reconcile with the server in the background.
      qc.invalidateQueries({ queryKey: TASKS_KEY })
    },
  })
}

export function useUpdateTask(number: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      title?: string
      description?: string
      priority?: TaskPriority | null
      state?: TaskState
      stateReason?: 'completed' | 'not_planned' // only when closing (discard = not_planned)
    }) =>
      fetchJson<Task>(`/api/tasks/${number}`, { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify(input) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [...TASKS_KEY, 'detail', number] })
      qc.invalidateQueries({ queryKey: [...TASKS_KEY, 'list'] })
    },
  })
}

export function useCreateComment(number: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: string) =>
      fetchJson<TaskComment>(`/api/tasks/${number}/comments`, {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ body }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...TASKS_KEY, 'detail', number] }),
  })
}

export function useUploadTaskImage() {
  // Returns a public URL to embed; no server state to invalidate.
  // oxlint-disable-next-line react-doctor/query-mutation-missing-invalidation
  return useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData()
      fd.set('file', file)
      return fetchJson<{ url: string }>('/api/tasks/upload', { method: 'POST', body: fd })
    },
  })
}
