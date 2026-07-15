/**
 * Toggle de sonidos de UI (issue #28). El wrapper @/lib/sound se mockea:
 * jsdom no tiene Web Audio y el componente solo debe ORQUESTAR (store + wrapper),
 * no sintetizar audio.
 */

import { describe, test, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SoundToggle } from '@/components/sound-toggle'
import { useSoundStore } from '@/stores/soundStore'
import { resetStores } from './helpers/stores'
import { setSoundEnabled, playSound } from '@/lib/sound'

vi.mock('@/lib/sound', () => ({
  setSoundEnabled: vi.fn(),
  playSound: vi.fn(),
  initSounds: vi.fn(),
}))

describe('SoundToggle', () => {
  beforeEach(() => {
    resetStores()
    vi.clearAllMocks()
  })

  test('con sonido activo muestra el aria-label de silenciar', () => {
    render(<SoundToggle />)
    expect(screen.getByRole('button', { name: 'Silenciar sonidos' })).toBeInTheDocument()
  })

  test('click silencia: store en false + setSoundEnabled(false), sin sonido de feedback', async () => {
    const user = userEvent.setup()
    render(<SoundToggle />)

    await user.click(screen.getByRole('button', { name: 'Silenciar sonidos' }))

    expect(useSoundStore.getState().soundEnabled).toBe(false)
    expect(setSoundEnabled).toHaveBeenCalledWith(false)
    expect(playSound).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Activar sonidos' })).toBeInTheDocument()
  })

  test('re-activar sincroniza el wrapper y toca el feedback "toggle"', async () => {
    const user = userEvent.setup()
    useSoundStore.setState({ soundEnabled: false })
    render(<SoundToggle />)

    await user.click(screen.getByRole('button', { name: 'Activar sonidos' }))

    expect(useSoundStore.getState().soundEnabled).toBe(true)
    expect(setSoundEnabled).toHaveBeenCalledWith(true)
    expect(playSound).toHaveBeenCalledWith('toggle')
  })
})
