/**
 * Parser del changelog TÉCNICO de la bóveda (`DYMMSA/06-Changelog/*.md`) que
 * alimenta la pestaña Actividad. Formato heterogéneo por antigüedad: los meses
 * recientes usan bloques `**[Área/#NN]:**` y los primeros `**Etiqueta:**`.
 */

export interface ActivityBlock {
  /** "Corte", "Feature / Fix", "Documentación"… vacío si el bloque no traía etiqueta. */
  area: string
  /** Issues del encabezado (`[Corte/#81]` → [81]); las del cuerpo las liga RichText. */
  issues: number[]
  title: string
  details: string[]
  motivo?: string
}

export interface ActivityDay {
  date: string
  /** Sufijo del heading cuando hubo varias entradas el mismo día ("II"). */
  label?: string
  /** Cierre de jornada de `**Total:**` ("636 tests, 0 fallos."). */
  total?: string
  blocks: ActivityBlock[]
}

export interface ActivityMonth {
  /** "2026-08" */
  month: string
  days: ActivityDay[]
}

const DATE_RE = /(\d{4}-\d{2}-\d{2})/
const SUFFIX_RE = /\(([^)]+)\)/
const BLOCK_RE = /^\*\*(.+?):\*\*\s*(.*)$/
const ISSUE_RE = /^#(\d+)$/

/** Etiquetas que amplían el bloque abierto en vez de abrir uno nuevo. */
const CONTINUATION = new Set([
  'motivo', 'total', 'decision', 'ver', 'nota', 'notas',
  'seguimiento', 'metricas', 'pendiente', 'tabla',
])

/** Sin acentos y en minúsculas — las etiquetas se escribieron a mano por meses. */
export function normalizeLabel(label: string): string {
  return label
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
}

/** Etiqueta larga = pseudo-título; como badge rompe el renglón. */
const MAX_AREA_LEN = 24

/** `[Corte/#81]` → area "Corte" + issues [81]; sin corchetes se usa tal cual. */
function parseArea(label: string): { area: string; issues: number[]; demoted?: string } {
  const inner = label.trim().replace(/^\[(.*)\]$/, '$1')
  const issues: number[] = []
  const areas: string[] = []
  for (const part of inner.split('/')) {
    const piece = part.trim()
    if (!piece) continue
    const issue = piece.match(ISSUE_RE)
    if (issue) issues.push(Number(issue[1]))
    else areas.push(piece)
  }
  const area = areas.join(' / ')

  // "Migración `20260409055423`" → badge "Migración" + folio al título.
  const migration = area.match(/^(Migraci[oó]n)\s+(.+)$/i)
  if (migration) return { area: migration[1], issues, demoted: migration[2] }

  if (area.length > MAX_AREA_LEN) return { area: '', issues, demoted: area }
  return { area, issues }
}

function newBlock(area: string, issues: number[], title: string): ActivityBlock {
  return { area, issues, title, details: [] }
}

/** Un archivo de mes → sus días, en el orden en que están escritos. */
export function parseVaultChangelog(raw: string): ActivityDay[] {
  const days: ActivityDay[] = []
  let day: ActivityDay | null = null
  let block: ActivityBlock | null = null

  for (const rawLine of raw.split('\n')) {
    const line = rawLine.trimEnd()
    const trimmed = line.trim()

    if (trimmed === '' || trimmed === '---') continue

    if (trimmed.startsWith('## ')) {
      const heading = trimmed.slice(3).trim()
      const date = heading.match(DATE_RE)
      block = null
      if (!date) {
        day = null
        continue
      }
      const suffix = heading.match(SUFFIX_RE)
      day = { date: date[1], label: suffix ? suffix[1] : undefined, blocks: [] }
      days.push(day)
      continue
    }

    // Título del archivo ("# Changelog técnico — Agosto 2026") y cualquier otro heading.
    if (trimmed.startsWith('#')) continue
    if (!day) continue

    // Viñeta: pertenece al bloque abierto (las anidadas se aplanan).
    if (/^[-*]\s+/.test(trimmed)) {
      const text = trimmed.replace(/^[-*]\s+/, '')
      if (!block) {
        block = newBlock('', [], text)
        day.blocks.push(block)
      } else {
        block.details.push(text)
      }
      continue
    }

    const header = trimmed.match(BLOCK_RE)
    if (header) {
      const label = header[1]
      const rest = header[2].trim()
      const key = normalizeLabel(label)

      if (CONTINUATION.has(key) && (block || key === 'total')) {
        if (key === 'motivo' && block) {
          block.motivo = block.motivo ? `${block.motivo} ${rest}` : rest
        } else if (key === 'total') {
          day.total = rest
        } else if (block) {
          block.details.push(`${label.trim()}: ${rest}`)
        }
        continue
      }

      const { area, issues, demoted } = parseArea(label)
      const title = demoted ? (rest ? `${demoted} — ${rest}` : demoted) : rest
      block = newBlock(area, issues, title)
      day.blocks.push(block)
      continue
    }

    // Párrafo suelto: cuerpo del bloque abierto.
    if (block) block.details.push(trimmed)
    else {
      block = newBlock('', [], trimmed)
      day.blocks.push(block)
    }
  }

  return days.filter((d) => d.blocks.length > 0 || d.total)
}

/**
 * Agrupa por el mes de la FECHA, no por el archivo: `2026-04.md` arrastra días
 * de marzo y agruparlos por nombre de archivo los mandaría al mes equivocado.
 */
export function groupActivityByMonth(days: readonly ActivityDay[]): ActivityMonth[] {
  const ordered = [...days].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
  const months: ActivityMonth[] = []
  for (const day of ordered) {
    const key = day.date.slice(0, 7)
    const last = months[months.length - 1]
    if (last && last.month === key) last.days.push(day)
    else months.push({ month: key, days: [day] })
  }
  return months
}
