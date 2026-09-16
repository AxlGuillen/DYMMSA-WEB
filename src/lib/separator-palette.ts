/** Separator palette (#73): rotates by index, `separator_color` overrides it and is validated ONLY
 *  here. Backgrounds are OPAQUE via color-mix — the pinned column uses bg-inherit and alpha would leak. */

export interface SeparatorTone {
  /** Label shown in the picker. */
  label: string
  /** Row background + left accent (light and dark). */
  row: string
  /** Color swatch in the picker. */
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

/** Rotation order of the automatic color. */
export const SEPARATOR_COLOR_KEYS = Object.keys(SEPARATOR_PALETTE)

export function isSeparatorColor(value: unknown): value is string {
  return typeof value === 'string' && value in SEPARATOR_PALETTE
}

/** Automatic color for the Nth separator (0-indexed). */
export function autoSeparatorColor(sectionIndex: number): string {
  const safe = Number.isInteger(sectionIndex) && sectionIndex >= 0 ? sectionIndex : 0
  return SEPARATOR_COLOR_KEYS[safe % SEPARATOR_COLOR_KEYS.length]
}

/** Valid override ?? automatic — an unknown DB value never blows up. */
export function resolveSeparatorColor(
  stored: string | null | undefined,
  sectionIndex: number,
): string {
  return isSeparatorColor(stored) ? stored : autoSeparatorColor(sectionIndex)
}

/** Row classes (background + accent) shared by the 4 screens. */
export function separatorRowClass(
  stored: string | null | undefined,
  sectionIndex: number,
): string {
  return SEPARATOR_PALETTE[resolveSeparatorColor(stored, sectionIndex)].row
}
