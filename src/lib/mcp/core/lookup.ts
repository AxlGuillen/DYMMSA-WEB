import { ToolError } from './errors'

/** Exactly one match or a ToolError that lists the candidates — the guard every name lookup shares (#109). */
export function requireSingleMatch<T>(matches: T[], label: (m: T) => string, what: string, query: string): T {
  if (matches.length === 0) throw new ToolError(`No hay ${what} que coincida con "${query}".`)
  if (matches.length > 1) {
    const shown = matches.slice(0, 5).map(label).join(', ')
    const count = matches.length > 5 ? 'más de 5' : String(matches.length)
    throw new ToolError(`Hay ${count} coincidencias (${shown}${matches.length > 5 ? ', …' : ''}) — precisa el nombre.`)
  }
  return matches[0]
}
