/**
 * In-app video tutorials (ADR-038): one typed catalog. A video appears next to the guided tour of the
 * screens in `tours`, and in the Documentación section `docs`; the Tutoriales tab lists them all.
 */

import type { TourId } from '@/lib/tours/registry'

/** Documentación sections a tutorial can belong to (their `id` anchors in /dashboard/docs). */
export type DocsAnchor = 'ordenes' | 'compra' | 'corte'

export interface Tutorial {
  slug: string
  /** Position in the Tutoriales tab; unique. */
  order: number
  /** 11 chars [A-Za-z0-9_-], or PENDING_ID while the video is not uploaded. */
  youtubeId: string
  title: string
  description: string
  /** "m:ss"; omitted until it is known. */
  duration?: string
  /** Screens whose "Vista guiada" gets a "Ver tutorial" next to it. */
  tours: readonly TourId[]
  docs: DocsAnchor
  /** Hidden from members in the Tutoriales tab; on a screen it follows that screen's own access. */
  adminOnly?: true
}

/** A video not uploaded yet: never shown anywhere. */
export const PENDING_ID = 'PENDIENTE'

export const YOUTUBE_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/

export const TUTORIALS: readonly Tutorial[] = [
  {
    slug: 'ordenes-1-cotizacion-a-entrega',
    order: 1,
    youtubeId: '_q6XfG344kI',
    title: 'Órdenes 1 · De la cotización a la entrega',
    description: 'Cómo una cotización aprobada se vuelve orden y cómo se sigue hasta entregarla.',
    tours: ['orders-list', 'order-detail'],
    docs: 'ordenes',
  },
  {
    slug: 'ordenes-2-planificar-compra',
    order: 2,
    youtubeId: 'WJuGV0D8fDg',
    title: 'Órdenes 2 · Planificar compra: ¿mayoreo o menudeo?',
    description: 'Qué se pide a URREA por paquete, qué se compra al menudeo y los dos Excel de compra.',
    tours: ['purchase-planner'],
    docs: 'compra',
  },
  {
    slug: 'ordenes-3-planificar-corte',
    order: 3,
    youtubeId: '8xgDHUaOCVM',
    title: 'Órdenes 3 · Planificar corte de tubos y placas de cobre',
    description: 'Cuánto tubo y placa pedir y cómo se acomodan las piezas en las medidas del proveedor.',
    tours: ['cut-planner'],
    docs: 'corte',
  },
]

export function isPublished(tutorial: Tutorial): boolean {
  return tutorial.youtubeId !== PENDING_ID && YOUTUBE_ID_PATTERN.test(tutorial.youtubeId)
}

/** Published, in order; a member never gets the admin-only ones. */
export function publishedTutorials(list: readonly Tutorial[], isAdmin: boolean): Tutorial[] {
  return list.filter((t) => isPublished(t) && (isAdmin || !t.adminOnly)).sort((a, b) => a.order - b.order)
}

export const tutorialsForTour = (tour: TourId, list: readonly Tutorial[] = TUTORIALS) =>
  publishedTutorials(list, true).filter((t) => t.tours.includes(tour))

/** Documentación is read by everyone and filters nothing by role: an admin-only video never shows there (review PR #142). */
export const tutorialsForDocs = (anchor: DocsAnchor, list: readonly Tutorial[] = TUTORIALS) =>
  publishedTutorials(list, false).filter((t) => t.docs === anchor)

function assertYoutubeId(youtubeId: string) {
  if (youtubeId === PENDING_ID || !YOUTUBE_ID_PATTERN.test(youtubeId)) throw new Error(`Invalid YouTube id: ${youtubeId}`)
}

/** youtube-nocookie: no YouTube cookies until the viewer presses play. */
export function embedUrl(youtubeId: string): string {
  assertYoutubeId(youtubeId)
  return `https://www.youtube-nocookie.com/embed/${youtubeId}?autoplay=1&playsinline=1&rel=0`
}

/** YouTube's own thumbnail (decision 2026-10-14): no covers to keep in the repo. */
export function coverUrl(youtubeId: string): string {
  assertYoutubeId(youtubeId)
  return `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg`
}
