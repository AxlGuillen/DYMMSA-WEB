/**
 * In-app video tutorials (ADR-038): one typed catalog. A video appears next to the guided tour of the
 * screens in `tours`, and in the Documentación section `docs`; the Tutoriales tab lists them all.
 */

import type { TourId } from '@/lib/tours/registry'

/** Documentación sections a tutorial can belong to (their `id` anchors in /dashboard/docs); each one already shows its button. */
export const DOCS_ANCHORS = ['cotizar', 'cotizaciones', 'ordenes', 'compra', 'corte'] as const
export type DocsAnchor = (typeof DOCS_ANCHORS)[number]

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
  /** The Documentación section it belongs to; a weekly delivery has none. */
  docs?: DocsAnchor
  /** Tutoriales tab: admins only. Documentación: never. A screen: that screen's own access. */
  adminOnly?: true
  /**
   * `entrega`: the weekly delivery video (what changed that week). Always admin-only, tied to no screen
   * nor docs section, and listed apart in the Tutoriales tab, newest first: its `order` is its week number.
   */
  kind?: 'entrega'
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
  {
    slug: 'entrega-semana-41',
    order: 41,
    kind: 'entrega',
    adminOnly: true,
    youtubeId: '7NFOmJw0abc',
    title: 'Entrega semana 41 · 5 al 9 de octubre',
    description: 'Resumen del equipo en Horas, el sábado por área en Nómina, el asistente en la rutina de los viernes y varios ajustes.',
    tours: [],
  },
  {
    slug: 'entrega-semana-42',
    order: 42,
    kind: 'entrega',
    adminOnly: true,
    youtubeId: 'jGJQ4j-6e_U',
    title: 'Entrega semana 42 · 12 al 17 de octubre',
    description: 'Tutoriales en video, la nueva sección Clientes con su estado de cuenta, la recepción más rápida y los arreglos de Cotizaciones.',
    tours: [],
  },
  {
    slug: 'entrega-semana-43',
    order: 43,
    kind: 'entrega',
    adminOnly: true,
    youtubeId: 'T3OFluiU4cI',
    title: 'Entrega semana 43 · 19 al 25 de octubre',
    description: 'El asistente ahora escribe, dos conectores (DYMMSA-WEB y Odoo), inventario y órdenes más seguros, e importaciones y facturas en dólares.',
    tours: [],
  },
]

export const isDelivery = (tutorial: Tutorial): boolean => tutorial.kind === 'entrega'

export function isPublished(tutorial: Tutorial): boolean {
  return tutorial.youtubeId !== PENDING_ID && YOUTUBE_ID_PATTERN.test(tutorial.youtubeId)
}

/** Published, in order; a member never gets the admin-only ones. */
export function publishedTutorials(list: readonly Tutorial[], isAdmin: boolean): Tutorial[] {
  return list.filter((t) => isPublished(t) && (isAdmin || !t.adminOnly)).sort((a, b) => a.order - b.order)
}

/** The module tutorials the Tutoriales tab lists for everyone, in order. */
export const publishedModules = (list: readonly Tutorial[], isAdmin: boolean): Tutorial[] =>
  publishedTutorials(list, isAdmin).filter((t) => !isDelivery(t))

/** The weekly deliveries, newest first. Only an admin gets them, whatever the entry says: a member gets none. */
export const publishedDeliveries = (list: readonly Tutorial[], isAdmin: boolean): Tutorial[] =>
  isAdmin ? publishedTutorials(list, true).filter(isDelivery).sort((a, b) => b.order - a.order) : []

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
