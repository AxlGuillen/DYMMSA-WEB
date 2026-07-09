/**
 * TasksPage — lista de tareas. Hooks de useTasks mockeados a nivel de módulo
 * (convención del proyecto); la lógica de red se cubre en tests/api.
 */

import { describe, test, expect, vi, beforeEach } from 'vitest'
import { renderWithProviders, screen, setupUser } from './helpers/render'
import TasksPage from '@/app/dashboard/tasks/page'
import { useTasks, useCreateTask, useUploadTaskImage } from '@/hooks/useTasks'
import type { Task } from '@/lib/github'

vi.mock('@/hooks/useTasks', () => ({
  useTasks: vi.fn(),
  useCreateTask: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useUploadTaskImage: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
}))
vi.mock('next/link', () => ({ default: ({ children }: { children: React.ReactNode }) => children }))

const mockUseTasks = vi.mocked(useTasks)

const task = (over: Partial<Task> = {}): Task => ({
  number: 5, title: 'Falla el total', description: 'x', priority: 'high', state: 'open',
  closedReason: null, reporter: 'axl@test.com', createdAt: '2026-07-09T10:00:00Z', closedAt: null,
  commentsCount: 0, url: 'https://github.com/o/r/issues/5', ...over,
})

beforeEach(() => {
  vi.mocked(useCreateTask).mockReturnValue({ mutateAsync: vi.fn(), isPending: false } as never)
  vi.mocked(useUploadTaskImage).mockReturnValue({ mutateAsync: vi.fn(), isPending: false } as never)
})

describe('TasksPage', () => {
  test('muestra las tareas con su prioridad', () => {
    mockUseTasks.mockReturnValue({ data: { tasks: [task()], page: 1 }, isLoading: false, error: null } as never)
    renderWithProviders(<TasksPage />)
    expect(screen.getByText('Falla el total')).toBeInTheDocument()
    // "Alta" aparece en el filtro de prioridad y en el badge de la fila.
    expect(screen.getAllByText('Alta').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Abierta')).toBeInTheDocument()
  })

  test('estado de carga', () => {
    mockUseTasks.mockReturnValue({ data: undefined, isLoading: true, error: null } as never)
    renderWithProviders(<TasksPage />)
    expect(screen.getByText(/Cargando tareas/)).toBeInTheDocument()
  })

  test('error (p. ej. token vencido) se muestra al usuario', () => {
    mockUseTasks.mockReturnValue({ data: undefined, isLoading: false, error: new Error('El token de GitHub expiró') } as never)
    renderWithProviders(<TasksPage />)
    expect(screen.getByText(/token de GitHub expiró/)).toBeInTheDocument()
  })

  test('vacío: invita a crear la primera', () => {
    mockUseTasks.mockReturnValue({ data: { tasks: [], page: 1 }, isLoading: false, error: null } as never)
    renderWithProviders(<TasksPage />)
    expect(screen.getByText(/Crear la primera/)).toBeInTheDocument()
  })

  test('abre el modal de nueva tarea', async () => {
    const user = setupUser()
    mockUseTasks.mockReturnValue({ data: { tasks: [task()], page: 1 }, isLoading: false, error: null } as never)
    renderWithProviders(<TasksPage />)
    await user.click(screen.getByRole('button', { name: /Nueva tarea/ }))
    expect(await screen.findByRole('heading', { name: 'Nueva tarea' })).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/El total no suma bien/)).toBeInTheDocument()
  })
})
