/** Presentation of the is_sold tri-state (null / true / false). */

export type SoldValue = boolean | null | undefined

/** Only `false` counts as "not sold". */
export function isNotSoldValue(v: SoldValue): boolean {
  return v === false
}

export function soldLabel(v: SoldValue): string {
  if (v === false) return 'No se vende'
  if (v === true) return 'Se vende'
  return 'Sin definir'
}

/** "Not sold" row background; beats the data-completeness tint. OPAQUE via color-mix — the pinned
 *  column uses bg-inherit and alpha would leak. */
export function notSoldRowClass(v: SoldValue): string {
  return v === false
    ? 'bg-[color-mix(in_oklab,var(--color-zinc-200)_70%,var(--background))] hover:bg-zinc-200 dark:bg-[color-mix(in_oklab,var(--color-zinc-800)_50%,var(--background))] dark:hover:bg-[color-mix(in_oklab,var(--color-zinc-800)_70%,var(--background))] text-muted-foreground'
    : ''
}
