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
 *
 * Los tonos van OPACOS vía `color-mix` (mismo color resultante que el `/70` o
 * `/50` sobre el fondo, pero sin canal alfa): la columna fija de acciones
 * hereda este color con `bg-inherit`, y con transparencia se alcanzaría a ver
 * el contenido de las columnas que pasan por debajo al hacer scroll lateral.
 */
export function notSoldRowClass(v: SoldValue): string {
  return v === false
    ? 'bg-[color-mix(in_oklab,var(--color-zinc-200)_70%,var(--background))] hover:bg-zinc-200 dark:bg-[color-mix(in_oklab,var(--color-zinc-800)_50%,var(--background))] dark:hover:bg-[color-mix(in_oklab,var(--color-zinc-800)_70%,var(--background))] text-muted-foreground'
    : ''
}
