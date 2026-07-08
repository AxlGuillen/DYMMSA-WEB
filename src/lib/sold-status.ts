/**
 * Estado "¿lo vendemos?" (tri-estado `is_sold`) — helpers de presentación
 * compartidos por el cotizador, el detalle de cotización y la aprobación.
 *
 *   null / undefined → sin definir (comportamiento normal, sin color)
 *   true             → sí lo vendemos (normal)
 *   false            → no lo vendemos (color distinto, se salta, "No disponible")
 */

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
 * Clase de fondo para filas "no lo vendemos". Tiene prioridad sobre el color
 * de completitud de datos: si no lo vendemos, no importa que falten datos.
 * Devuelve '' cuando no aplica.
 */
export function notSoldRowClass(v: SoldValue): string {
  return v === false
    ? 'bg-zinc-200/70 dark:bg-zinc-800/50 hover:bg-zinc-200 dark:hover:bg-zinc-800/70 text-muted-foreground'
    : ''
}
