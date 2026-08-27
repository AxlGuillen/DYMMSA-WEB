/**
 * Guard de open-redirect para ?next= (ADR-023), compartido por proxy y login.
 * Solo rutas del mismo origen: empieza con `/`, rechaza `//host` y `/\host`
 * (el navegador normaliza `\` a `/` → terminaría en otro origen).
 */
export function isSafeNext(next: string | null | undefined): next is string {
  if (!next || !next.startsWith('/')) return false
  const second = next[1]
  return second !== '/' && second !== '\\'
}
