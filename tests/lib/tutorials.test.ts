/** Video tutorials catalog (ADR-038): anti-drift checks, like the guided tours'. */

import { describe, test, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  coverUrl,
  embedUrl,
  PENDING_ID,
  publishedTutorials,
  TUTORIALS,
  tutorialsForDocs,
  tutorialsForTour,
  YOUTUBE_ID_PATTERN,
  type Tutorial,
} from '@/lib/tutorials'

const DOCS_DIR = join(process.cwd(), 'src/app/dashboard/docs')
const docsSource = [
  readFileSync(join(DOCS_DIR, 'page.tsx'), 'utf8'),
  ...readdirSync(join(DOCS_DIR, 'sections')).map((f) => readFileSync(join(DOCS_DIR, 'sections', f), 'utf8')),
].join('\n')

const video = (over: Partial<Tutorial>): Tutorial => ({
  slug: 'x', order: 1, youtubeId: 'abcdefghijk', title: 'X', description: 'x', tours: [], docs: 'ordenes', ...over,
})

describe('catálogo de tutoriales', () => {
  test('ids de YouTube válidos, slugs y orden únicos', () => {
    for (const t of TUTORIALS) expect(t.youtubeId === PENDING_ID || YOUTUBE_ID_PATTERN.test(t.youtubeId), t.slug).toBe(true)
    expect(new Set(TUTORIALS.map((t) => t.slug)).size).toBe(TUTORIALS.length)
    expect(new Set(TUTORIALS.map((t) => t.order)).size).toBe(TUTORIALS.length)
  })

  test('ANTI-DRIFT: la sección de documentación de cada video existe y muestra su botón', () => {
    for (const t of TUTORIALS) {
      expect(docsSource, `${t.slug} → #${t.docs}`).toMatch(new RegExp(`id(=|: )["']${t.docs}["']`))
      expect(docsSource, `${t.slug} sin botón en su sección`).toContain(`tutorialsForDocs('${t.docs}')`)
    }
  })

  test('cada video aparece en al menos una pantalla y los tres de Órdenes van donde se decidió', () => {
    for (const t of TUTORIALS) expect(t.tours.length, t.slug).toBeGreaterThan(0)
    expect(tutorialsForTour('orders-list').map((t) => t.youtubeId)).toEqual(['_q6XfG344kI'])
    expect(tutorialsForTour('order-detail').map((t) => t.youtubeId)).toEqual(['_q6XfG344kI'])
    expect(tutorialsForTour('purchase-planner').map((t) => t.youtubeId)).toEqual(['WJuGV0D8fDg'])
    expect(tutorialsForTour('cut-planner').map((t) => t.youtubeId)).toEqual(['8xgDHUaOCVM'])
    expect(tutorialsForTour('inventory')).toEqual([])
    expect(tutorialsForDocs('compra').map((t) => t.slug)).toEqual(['ordenes-2-planificar-compra'])
  })
})

describe('publicados', () => {
  test('un video pendiente o con id inválido nunca sale; en orden; el de admin no le sale a un member', () => {
    const list = [
      video({ slug: 'b', order: 2 }),
      video({ slug: 'a', order: 1 }),
      video({ slug: 'pend', order: 3, youtubeId: PENDING_ID }),
      video({ slug: 'bad', order: 4, youtubeId: 'corto' }),
      video({ slug: 'adm', order: 5, adminOnly: true }),
    ]
    expect(publishedTutorials(list, true).map((t) => t.slug)).toEqual(['a', 'b', 'adm'])
    expect(publishedTutorials(list, false).map((t) => t.slug)).toEqual(['a', 'b'])
    expect(tutorialsForTour('inventory', [video({ tours: ['inventory'], youtubeId: PENDING_ID })])).toEqual([])
  })

  test('el reproductor usa youtube-nocookie y la portada la miniatura de YouTube; un id pendiente revienta', () => {
    expect(embedUrl('_q6XfG344kI')).toBe('https://www.youtube-nocookie.com/embed/_q6XfG344kI?autoplay=1&playsinline=1&rel=0')
    expect(coverUrl('_q6XfG344kI')).toBe('https://i.ytimg.com/vi/_q6XfG344kI/hqdefault.jpg')
    expect(() => embedUrl(PENDING_ID)).toThrow()
    expect(() => coverUrl('nope')).toThrow()
  })
})
