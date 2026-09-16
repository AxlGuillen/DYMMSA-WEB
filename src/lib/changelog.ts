/** CHANGELOG.md parser: `##` date[—version] = release, `###` category, `- ` entry (indented lines continue it). */

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

    // Category: "### Mejorado"
    if (trimmed.startsWith('### ')) {
      category = normalizeCategory(trimmed.slice(4))
      continue
    }

    if (trimmed.startsWith('#')) continue
    if (!current || !category) continue

    if (trimmed.startsWith('- ')) {
      current.entries.push({ category, text: trimmed.slice(2).trim() })
      continue
    }

    // Wrapped continuation of the last entry in this category.
    const last = current.entries[current.entries.length - 1]
    if (last && last.category === category) {
      last.text = `${last.text} ${trimmed}`.trim()
    }
  }

  return releases
}
