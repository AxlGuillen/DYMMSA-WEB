/**
 * Sound wrapper (@/lib/sound): cuelume is mocked, so this covers orchestration, not audio.
 * Lives in tests/components (jsdom) because the delegated listener needs `document`.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('cuelume', () => ({
  play: vi.fn(),
  setEnabled: vi.fn(),
  bind: vi.fn(),
}))

import { play, setEnabled } from 'cuelume'
import { initSounds, setSoundEnabled, playSound } from '@/lib/sound'

function clickOn(el: Element) {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
}

describe('sound wrapper', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    document.body.innerHTML = ''
    // initSounds is idempotent via a module flag, already set by the first test that
    // called it — fine here: the click tests only need the listener to exist.
    initSounds(true)
  })
  afterEach(() => vi.useRealTimers())

  test('click en un botón toca "press"', () => {
    document.body.innerHTML = '<button id="b">Guardar</button>'
    vi.setSystemTime(1_000_000)
    clickOn(document.getElementById('b')!)
    expect(play).toHaveBeenCalledWith('press')
  })

  test('click fuera de un control interactivo NO suena', () => {
    document.body.innerHTML = '<div id="d">texto plano</div>'
    vi.setSystemTime(2_000_000)
    clickOn(document.getElementById('d')!)
    expect(play).not.toHaveBeenCalled()
  })

  test('click en botón disabled o aria-disabled NO suena', () => {
    // jsdom fires no click on native [disabled], so this covers the aria-disabled branch.
    document.body.innerHTML = '<a role="button" aria-disabled="true" id="a">No</a>'
    vi.setSystemTime(3_000_000)
    clickOn(document.getElementById('a')!)
    expect(play).not.toHaveBeenCalled()
  })

  test('throttle: ráfaga de clicks = un solo sonido; pasado el umbral vuelve a sonar', () => {
    document.body.innerHTML = '<button id="b">x</button>'
    const btn = document.getElementById('b')!

    vi.setSystemTime(4_000_000)
    clickOn(btn)
    clickOn(btn)
    clickOn(btn)
    expect(play).toHaveBeenCalledTimes(1)

    vi.setSystemTime(4_000_200) // > 80ms later
    clickOn(btn)
    expect(play).toHaveBeenCalledTimes(2)
  })

  test('el click delegado funciona sobre el hijo del control (closest)', () => {
    document.body.innerHTML = '<button id="b"><span id="s">icono</span></button>'
    vi.setSystemTime(5_000_000)
    clickOn(document.getElementById('s')!)
    expect(play).toHaveBeenCalledWith('press')
  })

  test('setSoundEnabled delega en cuelume.setEnabled', () => {
    setSoundEnabled(false)
    expect(setEnabled).toHaveBeenCalledWith(false)
  })

  test('playSound nunca lanza aunque cuelume truene', () => {
    vi.mocked(play).mockImplementationOnce(() => {
      throw new Error('AudioContext blocked')
    })
    expect(() => playSound('success')).not.toThrow()
  })
})
