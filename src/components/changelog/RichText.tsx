import Link from 'next/link'
import type { ReactNode } from 'react'

/**
 * Marcas en línea que los changelogs sí usan: `código`, **negritas**,
 * [[wikilinks]] de la bóveda y `#123` ligado a su tarea. No es un parser de
 * Markdown completo a propósito — nada más estas cuatro.
 */

/** Nueva instancia por llamada: el `lastIndex` de un /g compartido se pisa al anidar. */
const inlineRe = () => /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[\[[^\]]+\]\])|(#\d+)/g

function render(text: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = inlineRe()
  let last = 0
  let key = 0
  let match: RegExpExecArray | null

  while ((match = re.exec(text)) !== null) {
    if (match.index > last) out.push(text.slice(last, match.index))
    const [token] = match

    if (token.startsWith('`')) {
      out.push(
        <code key={key++} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">
          {token.slice(1, -1)}
        </code>,
      )
    } else if (token.startsWith('**')) {
      // El interior no puede traer `*`, así que esta recursión no se anida más.
      out.push(
        <strong key={key++} className="font-semibold text-foreground">
          {render(token.slice(2, -2))}
        </strong>,
      )
    } else if (token.startsWith('[[')) {
      const target = token.slice(2, -2)
      const label = (target.split('|')[1] ?? target.split('/').pop() ?? target).trim()
      out.push(
        <span key={key++} className="italic text-muted-foreground">
          {label}
        </span>,
      )
    } else {
      out.push(
        <Link
          key={key++}
          href={`/dashboard/tasks/${token.slice(1)}`}
          className="font-medium text-primary hover:underline"
        >
          {token}
        </Link>,
      )
    }
    last = match.index + token.length
  }

  if (last < text.length) out.push(text.slice(last))
  return out
}

export function RichText({ text }: { text: string }) {
  return <>{render(text)}</>
}
