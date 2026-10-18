/** Video tutorials catalog (ADR-038): anti-drift checks, like the guided tours'. */

import { describe, test, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  coverUrl,
  DOCS_ANCHORS,
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
const docsFiles = [
  readFileSync(join(DOCS_DIR, 'page.tsx'), 'utf8'),
  ...readdirSync(join(DOCS_DIR, 'sections')).map((f) => readFileSync(join(DOCS_DIR, 'sections', f), 'utf8')),
]

/**
 * The source of the ONE section whose element carries `id="<anchor>"`, up to the next `id=` in the file.
 * Assumes the button comes before any nested `id=` (true in the five sections today).
 */
function sectionSource(anchor: string): string | null {
  const pattern = new RegExp(`id=["']${anchor}["']`, 'g')
  const hits = docsFiles.flatMap((file) => [...file.matchAll(pattern)].map((m) => ({ file, start: m.index ?? 0 })))
  if (hits.length !== 1) return null
  const rest = hits[0].file.slice(hits[0].start + 1)
  const next = rest.search(/\bid=["'][a-z-]+["']/)
  return next < 0 ? rest : rest.slice(0, next)
}

const video = (over: Partial<Tutorial>): Tutorial => ({
  slug: 'x', order: 1, youtubeId: 'abcdefghijk', title: 'X', description: 'x', tours: [], docs: 'ordenes', ...over,
})

describe('catálogo de tutoriales', () => {
  test('ids de YouTube válidos, slugs y orden únicos', () => {
    for (const t of TUTORIALS) expect(t.youtubeId === PENDING_ID || YOUTUBE_ID_PATTERN.test(t.youtubeId), t.slug).toBe(true)
    expect(new Set(TUTORIALS.map((t) => t.slug)).size).toBe(TUTORIALS.length)
    expect(new Set(TUTORIALS.map((t) => t.order)).size).toBe(TUTORIALS.length)
  })

  test('ANTI-DRIFT: la sección de documentación de cada video existe y muestra su botón dentro de ella', () => {
    for (const t of TUTORIALS) {
      const section = sectionSource(t.docs)
      expect(section, `${t.slug} → #${t.docs} no existe o está repetida`).not.toBeNull()
      expect(section, `${t.slug}: el botón no está en la sección #${t.docs}`).toContain(`tutorialsForDocs('${t.docs}')`)
    }
  })

  test('ANTI-DRIFT: cada sección de documentación del catálogo existe y ya muestra su botón, aunque aún no tenga video', () => {
    for (const anchor of DOCS_ANCHORS) {
      const section = sectionSource(anchor)
      expect(section, `#${anchor} no existe o está repetida`).not.toBeNull()
      expect(section, `el botón no está en la sección #${anchor}`).toContain(`tutorialsForDocs('${anchor}')`)
    }
  })

  test('REGLA: ningún video en la página pública de aprobación (sin sesión; su liga a docs mandaría al login)', () => {
    expect(TUTORIALS.filter((t) => t.tours.includes('approval')).map((t) => t.slug)).toEqual([])
  })

  test('cada video aparece en al menos una pantalla y los tres de Órdenes van donde se decidió', () => {
    for (const t of TUTORIALS) expect(t.tours.length, t.slug).toBeGreaterThan(0)
    expect(tutorialsForTour('orders-list').map((t) => t.youtubeId)).toEqual(['_q6XfG344kI'])
    expect(tutorialsForTour('order-detail').map((t) => t.youtubeId)).toEqual(['_q6XfG344kI'])
    expect(tutorialsForTour('purchase-planner').map((t) => t.youtubeId)).toEqual(['WJuGV0D8fDg'])
    expect(tutorialsForTour('cut-planner').map((t) => t.youtubeId)).toEqual(['8xgDHUaOCVM'])
    expect(tutorialsForTour('inventory')).toEqual([])
    expect(tutorialsForDocs('compra').map((t) => t.slug)).toEqual(['ordenes-2-planificar-compra'])
    expect(tutorialsForDocs('cotizar')).toEqual([])
    expect(tutorialsForDocs('cotizaciones')).toEqual([])
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

  test('REGLA: un video de admin nunca sale en Documentación, que lee todo el equipo (review PR #142)', () => {
    const list = [video({ slug: 'todos', docs: 'compra' }), video({ slug: 'adm', order: 2, docs: 'compra', adminOnly: true })]
    expect(tutorialsForDocs('compra', list).map((t) => t.slug)).toEqual(['todos'])
  })

  test('el reproductor usa youtube-nocookie y la portada la miniatura de YouTube; un id pendiente revienta', () => {
    expect(embedUrl('_q6XfG344kI')).toBe('https://www.youtube-nocookie.com/embed/_q6XfG344kI?autoplay=1&playsinline=1&rel=0')
    expect(coverUrl('_q6XfG344kI')).toBe('https://i.ytimg.com/vi/_q6XfG344kI/hqdefault.jpg')
    expect(() => embedUrl(PENDING_ID)).toThrow()
    expect(() => coverUrl('nope')).toThrow()
  })
})
