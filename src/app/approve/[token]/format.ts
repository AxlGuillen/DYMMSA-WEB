/** Formato de moneda MXN para la página pública de aprobación (sin modo discreto). */
export function formatMoney(value: number): string {
  return `$${value.toLocaleString('es-MX', { minimumFractionDigits: 2 })}`
}
