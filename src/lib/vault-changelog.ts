/** Parser for the vault's technical changelog. The format is heterogeneous by age: recent months use
 *  `**[Área/#NN]:**` blocks, the earliest ones plain `**Etiqueta:**`. */

export interface ActivityBlock {
  /** Empty when the block carried no label. */
  area: string
  /** Issues from the heading; the ones in the body are linked by RichText. */
  issues: number[]
  title: string
  details: string[]
  motivo?: string
}

export interface ActivityDay {
  date: string
  /** Heading suffix when a day holds several entries ("II"). */
  label?: string
  /** End-of-day `**Total:**` line. */
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

/** Labels that extend the open block instead of starting a new one. */
const CONTINUATION = new Set([
  'motivo', 'total', 'decision', 'ver', 'nota', 'notas',
  'seguimiento', 'metricas', 'pendiente', 'tabla',
])

/** Accent-free lowercase: the labels were hand-written over months. */
export function normalizeLabel(label: string): string {
  return label
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
}

/** A long label is really a title; as a badge it breaks the line. */
const MAX_AREA_LEN = 24

/** `[Corte/#81]` → area "Corte" + issues [81]; without brackets it is used as-is. */
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

  // "Migración <id>" → badge "Migración" with the id demoted into the title.
  const migration = area.match(/^(Migraci[oó]n)\s+(.+)$/i)
  if (migration) return { area: migration[1], issues, demoted: migration[2] }

  if (area.length > MAX_AREA_LEN) return { area: '', issues, demoted: area }
  return { area, issues }
}

function newBlock(area: string, issues: number[], title: string): ActivityBlock {
  return { area, issues, title, details: [] }
}

/** One month file → its days, in written order. */
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

    if (trimmed.startsWith('#')) continue
    if (!day) continue

    // Bullets belong to the open block; nested ones are flattened.
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

    // Loose paragraph: body of the open block.
    if (block) block.details.push(trimmed)
    else {
      block = newBlock('', [], trimmed)
      day.blocks.push(block)
    }
  }

  return days.filter((d) => d.blocks.length > 0 || d.total)
}

/** Group by the DATE's month, not by the file: `2026-04.md` carries March days. */
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
