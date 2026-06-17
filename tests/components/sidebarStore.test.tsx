import { describe, test, expect, beforeEach } from 'vitest'
import { useSidebarStore } from '@/stores/sidebarStore'
import { resetStores } from './helpers/stores'

describe('sidebarStore', () => {
  beforeEach(() => resetStores())

  test('default colapsado = false', () => {
    expect(useSidebarStore.getState().collapsed).toBe(false)
  })

  test('toggleCollapsed alterna el estado', () => {
    useSidebarStore.getState().toggleCollapsed()
    expect(useSidebarStore.getState().collapsed).toBe(true)
    useSidebarStore.getState().toggleCollapsed()
    expect(useSidebarStore.getState().collapsed).toBe(false)
  })

  test('setCollapsed fija el valor', () => {
    useSidebarStore.getState().setCollapsed(true)
    expect(useSidebarStore.getState().collapsed).toBe(true)
  })
})
