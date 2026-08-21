/**
 * Paleta de colores de separadores (issue #73).
 *
 * Cada sección de una cotización/orden se tiñe para leer la jerarquía de un
 * vistazo: por defecto el color ROTA por índice de sección (posición del
 * separador en el documento), y un separador puede fijar un override manual
 * (`separator_color` en BD; NULL = automático).
 *
 * Los fondos van OPACOS vía `color-mix` (nunca alfa): la columna fija de
 * acciones hereda el color con `bg-inherit`, y con transparencia se vería el
 * contenido pasando por debajo al hacer scroll lateral (ver notSoldRowClass).
 * Clases estáticas a propósito — Tailwind no compila valores en runtime.
 *
 * `separator_color` es TEXT libre en BD (no enum): la validación vive SOLO
 * aquí. Una escritura fuera de save/update (p. ej. un futuro `set_*` del MCP)
 * podría guardar un valor fuera de la paleta — `resolveSeparatorColor` lo
 * absorbe cayendo a automático, en silencio.
 */

export interface SeparatorTone {
  /** Nombre visible en el picker. */
  label: string
  /** Fondo + acento izquierdo de la fila del separador (light y dark). */
  row: string
  /** Muestra del color en el picker. */
  swatch: string
}

export const SEPARATOR_PALETTE: Record<string, SeparatorTone> = {
  teal: {
    label: 'Verde azulado',
    row: 'border-l-4 border-l-teal-500 bg-[color-mix(in_oklab,var(--color-teal-100)_55%,var(--background))] dark:bg-[color-mix(in_oklab,var(--color-teal-950)_45%,var(--background))] hover:bg-[color-mix(in_oklab,var(--color-teal-100)_55%,var(--background))] dark:hover:bg-[color-mix(in_oklab,var(--color-teal-950)_45%,var(--background))]',
    swatch: 'bg-teal-500',
  },
  blue: {
    label: 'Azul',
    row: 'border-l-4 border-l-blue-500 bg-[color-mix(in_oklab,var(--color-blue-100)_55%,var(--background))] dark:bg-[color-mix(in_oklab,var(--color-blue-950)_45%,var(--background))] hover:bg-[color-mix(in_oklab,var(--color-blue-100)_55%,var(--background))] dark:hover:bg-[color-mix(in_oklab,var(--color-blue-950)_45%,var(--background))]',
    swatch: 'bg-blue-500',
  },
  violet: {
    label: 'Violeta',
    row: 'border-l-4 border-l-violet-500 bg-[color-mix(in_oklab,var(--color-violet-100)_55%,var(--background))] dark:bg-[color-mix(in_oklab,var(--color-violet-950)_45%,var(--background))] hover:bg-[color-mix(in_oklab,var(--color-violet-100)_55%,var(--background))] dark:hover:bg-[color-mix(in_oklab,var(--color-violet-950)_45%,var(--background))]',
    swatch: 'bg-violet-500',
  },
  rose: {
    label: 'Rosa',
    row: 'border-l-4 border-l-rose-500 bg-[color-mix(in_oklab,var(--color-rose-100)_55%,var(--background))] dark:bg-[color-mix(in_oklab,var(--color-rose-950)_45%,var(--background))] hover:bg-[color-mix(in_oklab,var(--color-rose-100)_55%,var(--background))] dark:hover:bg-[color-mix(in_oklab,var(--color-rose-950)_45%,var(--background))]',
    swatch: 'bg-rose-500',
  },
  amber: {
    label: 'Ámbar',
    row: 'border-l-4 border-l-amber-500 bg-[color-mix(in_oklab,var(--color-amber-100)_55%,var(--background))] dark:bg-[color-mix(in_oklab,var(--color-amber-950)_45%,var(--background))] hover:bg-[color-mix(in_oklab,var(--color-amber-100)_55%,var(--background))] dark:hover:bg-[color-mix(in_oklab,var(--color-amber-950)_45%,var(--background))]',
    swatch: 'bg-amber-500',
  },
  lime: {
    label: 'Lima',
    row: 'border-l-4 border-l-lime-500 bg-[color-mix(in_oklab,var(--color-lime-100)_55%,var(--background))] dark:bg-[color-mix(in_oklab,var(--color-lime-950)_45%,var(--background))] hover:bg-[color-mix(in_oklab,var(--color-lime-100)_55%,var(--background))] dark:hover:bg-[color-mix(in_oklab,var(--color-lime-950)_45%,var(--background))]',
    swatch: 'bg-lime-500',
  },
  slate: {
    label: 'Gris',
    row: 'border-l-4 border-l-slate-400 bg-[color-mix(in_oklab,var(--color-slate-200)_55%,var(--background))] dark:bg-[color-mix(in_oklab,var(--color-slate-800)_60%,var(--background))] hover:bg-[color-mix(in_oklab,var(--color-slate-200)_55%,var(--background))] dark:hover:bg-[color-mix(in_oklab,var(--color-slate-800)_60%,var(--background))]',
    swatch: 'bg-slate-400',
  },
}

/** Orden de rotación del color automático. */
export const SEPARATOR_COLOR_KEYS = Object.keys(SEPARATOR_PALETTE)

export function isSeparatorColor(value: unknown): value is string {
  return typeof value === 'string' && value in SEPARATOR_PALETTE
}

/** Color automático del N-ésimo separador del documento (0-indexado). */
export function autoSeparatorColor(sectionIndex: number): string {
  const safe = Number.isInteger(sectionIndex) && sectionIndex >= 0 ? sectionIndex : 0
  return SEPARATOR_COLOR_KEYS[safe % SEPARATOR_COLOR_KEYS.length]
}

/** Override válido ?? automático — un valor desconocido en BD nunca revienta. */
export function resolveSeparatorColor(
  stored: string | null | undefined,
  sectionIndex: number,
): string {
  return isSeparatorColor(stored) ? stored : autoSeparatorColor(sectionIndex)
}

/** Clases de la fila del separador (fondo + acento) para las 4 pantallas. */
export function separatorRowClass(
  stored: string | null | undefined,
  sectionIndex: number,
): string {
  return SEPARATOR_PALETTE[resolveSeparatorColor(stored, sectionIndex)].row
}
