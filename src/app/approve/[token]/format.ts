/** MXN currency for the public approval page — discrete mode never applies here. */
export function formatMoney(value: number): string {
  return `$${value.toLocaleString('es-MX', { minimumFractionDigits: 2 })}`
}
