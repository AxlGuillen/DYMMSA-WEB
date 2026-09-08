/** Open-redirect guard for ?next= (ADR-023): same-origin paths only. `//host` and `/\host` are
 *  rejected because the browser normalizes `\` to `/` and would land on another origin. */
export function isSafeNext(next: string | null | undefined): next is string {
  if (!next || !next.startsWith('/')) return false
  const second = next[1]
  return second !== '/' && second !== '\\'
}
