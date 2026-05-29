import { describe, test, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DiscreteModeToggle } from '@/components/discrete-mode-toggle'
import { useDiscreteModeStore } from '@/stores/discreteModeStore'
import { resetStores } from './helpers/stores'

describe('DiscreteModeToggle', () => {
  beforeEach(() => resetStores())

  test('arranca en modo normal: aria-label de activar', () => {
    render(<DiscreteModeToggle />)
    expect(screen.getByRole('button', { name: 'Activar modo discreto' })).toBeInTheDocument()
  })

  test('click alterna el store y el aria-label', async () => {
    const user = userEvent.setup()
    render(<DiscreteModeToggle />)

    await user.click(screen.getByRole('button', { name: 'Activar modo discreto' }))

    expect(useDiscreteModeStore.getState().isDiscreteMode).toBe(true)
    expect(
      screen.getByRole('button', { name: 'Desactivar modo discreto' }),
    ).toBeInTheDocument()
  })

  test('segundo click vuelve a modo normal', async () => {
    const user = userEvent.setup()
    useDiscreteModeStore.setState({ isDiscreteMode: true })
    render(<DiscreteModeToggle />)

    await user.click(screen.getByRole('button', { name: 'Desactivar modo discreto' }))

    expect(useDiscreteModeStore.getState().isDiscreteMode).toBe(false)
  })
})
