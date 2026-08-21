/** Presentación del tri-estado is_sold (null=sin definir, true=sí, false="No disponible"). */

export type SoldValue = boolean | null | undefined

/** ¿El ítem está marcado como "no lo vendemos"? Solo `false` cuenta. */
export function isNotSoldValue(v: SoldValue): boolean {
  return v === false
}

export function soldLabel(v: SoldValue): string {
  if (v === false) return 'No se vende'
  if (v === true) return 'Se vende'
  return 'Sin definir'
}

/**
 * Fondo de filas "no lo vendemos" (gana a la completitud de datos). Tonos
 * OPACOS vía color-mix: la columna fija hereda con bg-inherit y el alfa transparentaría.
 */
export function notSoldRowClass(v: SoldValue): string {
  return v === false
    ? 'bg-[color-mix(in_oklab,var(--color-zinc-200)_70%,var(--background))] hover:bg-zinc-200 dark:bg-[color-mix(in_oklab,var(--color-zinc-800)_50%,var(--background))] dark:hover:bg-[color-mix(in_oklab,var(--color-zinc-800)_70%,var(--background))] text-muted-foreground'
    : ''
}
