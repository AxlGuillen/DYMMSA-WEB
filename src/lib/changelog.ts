/**
 * Parser del CHANGELOG.md (raíz) a una estructura tipada para renderizar la
 * línea de tiempo de "Novedades". Función pura (sin fs) → testeable.
 *
 * Formato esperado (variante Keep a Changelog en español):
 *
 *   # Novedades
 *   <intro opcional, se ignora>
 *
 *   ## 2026-06-09 — v1.4      ← release (fecha + versión opcional)
 *
 *   ### Mejorado              ← categoría
 *   - entrada                 ← entrada (puede continuar en líneas siguientes)
 *     continuación de la entrada
 *
 * Reglas:
 *  - `## ` abre un release. Extrae la fecha (YYYY-MM-DD) y, si existe, la versión.
 *  - `### ` cambia la categoría activa (Nuevo / Mejorado / Corregido).
 *  - `- ` abre una entrada bajo la categoría activa. Líneas indentadas siguientes
 *    (sin `-`) se concatenan a la última entrada.
 *  - `#`, `---`, intro y líneas sin categoría activa se ignoran.
 */

export type ChangelogCategory = 'nuevo' | 'mejorado' | 'corregido'

export interface ChangelogEntry {
  category: ChangelogCategory
  text: string
}

export interface ChangelogRelease {
  date: string
  version?: string
  entries: ChangelogEntry[]
}

const CATEGORY_MAP: Record<string, ChangelogCategory> = {
  nuevo: 'nuevo',
  nuevos: 'nuevo',
  agregado: 'nuevo',
  mejorado: 'mejorado',
  mejoras: 'mejorado',
  cambiado: 'mejorado',
  corregido: 'corregido',
  correcciones: 'corregido',
  arreglado: 'corregido',
}

const DATE_RE = /(\d{4}-\d{2}-\d{2})/
const VERSION_RE = /v\d+(?:\.\d+)*/i

function normalizeCategory(heading: string): ChangelogCategory | null {
  const key = heading.trim().toLowerCase()
  return CATEGORY_MAP[key] ?? null
}

export function parseChangelog(raw: string): ChangelogRelease[] {
  const releases: ChangelogRelease[] = []
  let current: ChangelogRelease | null = null
  let category: ChangelogCategory | null = null

  for (const rawLine of raw.split('\n')) {
    const line = rawLine.trimEnd()
    const trimmed = line.trim()

    if (trimmed === '' || trimmed === '---') continue

    // Release: "## 2026-06-09 — v1.4"
    if (trimmed.startsWith('## ')) {
      const heading = trimmed.slice(3).trim()
      const dateMatch = heading.match(DATE_RE)
      if (!dateMatch) {
        current = null
        category = null
        continue
      }
      const versionMatch = heading.match(VERSION_RE)
      current = {
        date: dateMatch[1],
        version: versionMatch ? versionMatch[0] : undefined,
        entries: [],
      }
      category = null
      releases.push(current)
      continue
    }

    // Categoría: "### Mejorado"
    if (trimmed.startsWith('### ')) {
      category = normalizeCategory(trimmed.slice(4))
      continue
    }

    // Top-level heading "# ..." u otra cosa fuera de un release → ignorar
    if (trimmed.startsWith('#')) continue
    if (!current || !category) continue

    // Entrada nueva: "- texto"
    if (trimmed.startsWith('- ')) {
      current.entries.push({ category, text: trimmed.slice(2).trim() })
      continue
    }

    // Continuación (wrap) de la última entrada de esta categoría
    const last = current.entries[current.entries.length - 1]
    if (last && last.category === category) {
      last.text = `${last.text} ${trimmed}`.trim()
    }
  }

  return releases
}
