/**
 * Guard de open-redirect para el parámetro `?next=` (ADR-023).
 *
 * Vive aparte y sin dependencias porque lo usan dos runtimes distintos: el
 * proxy (middleware) y la página de login (cliente). Duplicar la condición
 * sería duplicar una decisión de seguridad, que es justo lo que se
 * desincroniza con el tiempo.
 *
 * Solo se aceptan rutas relativas del MISMO origen:
 *   - debe empezar con `/`
 *   - se rechaza `//host` (protocol-relative → otro origen)
 *   - se rechaza `/\host`: el navegador normaliza la barra invertida a `/`,
 *     así que `/\evil.com` termina siendo `//evil.com`.
 */
export function isSafeNext(next: string | null | undefined): next is string {
  if (!next || !next.startsWith('/')) return false
  const second = next[1]
  return second !== '/' && second !== '\\'
}
