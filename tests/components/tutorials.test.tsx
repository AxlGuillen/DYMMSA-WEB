/** Video tutorials (ADR-038): the button next to the guided tour, the shared player and the Tutoriales tab. */

import { describe, test, expect, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { TourButton } from '@/components/tours/TourButton'
import { TutorialButton } from '@/components/tutorials/TutorialButton'
import { TutorialList } from '@/components/tutorials/TutorialList'
import { DocsTabs } from '@/components/docs/DocsTabs'
import TutorialsPage from '@/app/dashboard/docs/tutoriales/page'
import { TUTORIALS, type Tutorial } from '@/lib/tutorials'

const session = vi.hoisted(() => ({ role: 'admin' as 'admin' | 'member' }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(async () => ({})) }))
vi.mock('@/lib/api-helpers', () => ({ requireRole: vi.fn(async () => ({ profile: { role: session.role } })) }))
vi.mock('driver.js', () => ({ driver: vi.fn(() => ({ drive: vi.fn() })) }))
vi.mock('driver.js/dist/driver.css', () => ({}))
vi.mock('next/image', () => ({
  default: (props: Record<string, unknown>) => {
    const { fill: _fill, unoptimized: _unoptimized, ...rest } = props
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    return <img {...(rest as Record<string, string>)} />
  },
}))

const video = (over: Partial<Tutorial>): Tutorial => ({
  slug: 'uno', order: 1, youtubeId: 'abcdefghijk', title: 'Video uno', description: 'Primero', tours: [], docs: 'compra', ...over,
})

describe('TourButton', () => {
  test('una pantalla con video gana "Ver tutorial" junto a la vista guiada; una sin video no', () => {
    const { unmount } = render(<TourButton tour="purchase-planner" />)
    expect(screen.getByRole('button', { name: 'Vista guiada' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Ver tutorial/ })).toBeInTheDocument()
    unmount()

    render(<TourButton tour="inventory" />)
    expect(screen.getByRole('button', { name: 'Vista guiada' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Ver tutorial/ })).not.toBeInTheDocument()
  })
})

describe('reproductor', () => {
  test('el iframe de youtube-nocookie solo aparece al dar play; antes, la portada', () => {
    render(<TourButton tour="cut-planner" />)
    fireEvent.click(screen.getByRole('button', { name: /Ver tutorial/ }))
    const dialog = screen.getByRole('dialog')
    const tutorial = TUTORIALS.find((t) => t.tours.includes('cut-planner'))!
    expect(within(dialog).getByText(tutorial.title)).toBeInTheDocument()
    expect(dialog.querySelector('iframe')).toBeNull()
    expect(dialog.querySelector('img')?.getAttribute('src')).toBe(`https://i.ytimg.com/vi/${tutorial.youtubeId}/hqdefault.jpg`)

    fireEvent.click(within(dialog).getByRole('button', { name: `Reproducir: ${tutorial.title}` }))
    expect(dialog.querySelector('iframe')?.getAttribute('src')).toBe(`https://www.youtube-nocookie.com/embed/${tutorial.youtubeId}?autoplay=1&playsinline=1&rel=0`)
    expect(within(dialog).getByRole('link', { name: /Leer en la documentación/ })).toHaveAttribute('href', '/dashboard/docs#corte')
  })

  test('con dos videos se elige cuál; dentro de Documentación no se liga a sí misma', () => {
    render(<TutorialButton tutorials={[video({}), video({ slug: 'dos', order: 2, youtubeId: 'bcdefghijkl', title: 'Video dos', description: 'Segundo' })]} showDocsLink={false} />)
    fireEvent.click(screen.getByRole('button', { name: /Ver tutorial/ }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByRole('heading', { name: 'Video uno' })).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Video dos' }))
    expect(within(dialog).getByRole('heading', { name: 'Video dos' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Video dos' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(dialog).queryByRole('link', { name: /Leer en la documentación/ })).not.toBeInTheDocument()
  })

  test('sin videos, o solo con uno pendiente, no hay botón (un error del catálogo no tumba la pantalla)', () => {
    const { container, rerender } = render(<TutorialButton tutorials={[]} />)
    expect(container).toBeEmptyDOMElement()
    rerender(<TutorialButton tutorials={[video({ youtubeId: 'PENDIENTE' })]} />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('pestaña Tutoriales', () => {
  test('una tarjeta por video, en orden, con su liga a la documentación y el reproductor al abrirla', () => {
    render(<TutorialList tutorials={TUTORIALS} />)
    const items = within(screen.getByRole('list', { name: 'Tutoriales' })).getAllByRole('listitem')
    expect(items).toHaveLength(TUTORIALS.length)
    expect(within(items[1]).getByRole('link', { name: /Leer en la documentación/ })).toHaveAttribute('href', `/dashboard/docs#${TUTORIALS[1].docs}`)
    fireEvent.click(within(items[0]).getByRole('button', { name: `Ver ${TUTORIALS[0].title}` }))
    expect(within(screen.getByRole('dialog')).getByRole('heading', { name: TUTORIALS[0].title })).toBeInTheDocument()
  })

  test('una entrega semanal no liga a la documentación, ni en la tarjeta ni dentro del reproductor', () => {
    const delivery = TUTORIALS.find((t) => t.kind === 'entrega')!
    render(<TutorialList tutorials={[delivery]} label="Entregas semanales" />)
    const items = within(screen.getByRole('list', { name: 'Entregas semanales' })).getAllByRole('listitem')
    expect(items).toHaveLength(1)
    expect(within(items[0]).queryByRole('link')).not.toBeInTheDocument()
    fireEvent.click(within(items[0]).getByRole('button', { name: `Ver ${delivery.title}` }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByRole('heading', { name: delivery.title })).toBeInTheDocument()
    expect(within(dialog).queryByRole('link', { name: /Leer en la documentación/ })).not.toBeInTheDocument()
  })

  test('las pestañas de Documentación marcan la actual', () => {
    render(<DocsTabs active="tutoriales" />)
    expect(screen.getByRole('link', { name: /Tutoriales/ })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: /Documentación/ })).toHaveAttribute('href', '/dashboard/docs')
  })
})

describe('página Tutoriales: entregas semanales', () => {
  test('un administrador las ve en su apartado, de la más reciente a la más antigua, aparte de los tutoriales', async () => {
    session.role = 'admin'
    render(await TutorialsPage())
    expect(within(screen.getByRole('list', { name: 'Tutoriales' })).getAllByRole('listitem')).toHaveLength(3)
    const section = screen.getByRole('region', { name: /Entregas semanales/ })
    expect(within(section).getByText('Solo administradores')).toBeInTheDocument()
    const items = within(within(section).getByRole('list', { name: 'Entregas semanales' })).getAllByRole('listitem')
    expect(items.map((li) => within(li).getByText(/^Entrega semana \d+/).textContent)).toEqual([
      'Entrega semana 43 · 19 al 25 de octubre',
      'Entrega semana 42 · 12 al 17 de octubre',
      'Entrega semana 41 · 5 al 9 de octubre',
    ])
  })

  test('un miembro ve los tutoriales y ningún rastro del apartado', async () => {
    session.role = 'member'
    render(await TutorialsPage())
    expect(within(screen.getByRole('list', { name: 'Tutoriales' })).getAllByRole('listitem')).toHaveLength(3)
    expect(screen.queryByRole('region', { name: /Entregas semanales/ })).not.toBeInTheDocument()
    expect(screen.queryByText(/Entrega semana/)).not.toBeInTheDocument()
    expect(screen.queryByText('Solo administradores')).not.toBeInTheDocument()
  })
})
