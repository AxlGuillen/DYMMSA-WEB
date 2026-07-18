import { formatMoney } from './format'

interface SummaryTilesProps {
  customerName: string
  createdAt: string
  productCount: number
  subtotal: number
}

/** Tiles de resumen de la cotización (glass) — Cliente / Productos / Subtotal. */
export function SummaryTiles({ customerName, createdAt, productCount, subtotal }: SummaryTilesProps) {
  const tile =
    'rounded-2xl border border-border/60 bg-card/70 backdrop-blur-xl p-6 shadow-sm'
  const label =
    'font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground'

  return (
    <div className="grid gap-4 sm:grid-cols-[1.7fr_1fr_1fr]">
      <div className={tile}>
        <div className={`${label} mb-2`}>Cliente</div>
        <div className="text-xl font-bold leading-tight tracking-tight sm:text-2xl">
          {customerName}
        </div>
        <div className="mt-2 text-xs text-muted-foreground">
          Emitida el{' '}
          {new Date(createdAt).toLocaleDateString('es-MX', {
            day: '2-digit',
            month: 'long',
            year: 'numeric',
          })}
        </div>
      </div>

      <div className={`${tile} flex flex-col justify-center`}>
        <div className={label}>Productos</div>
        <div className="text-3xl font-bold tabular-nums">{productCount}</div>
      </div>

      <div className="flex flex-col justify-center rounded-2xl border border-[#A30305]/25 bg-gradient-to-br from-[#A30305]/10 to-card/40 p-6 shadow-sm backdrop-blur-xl">
        <div className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-[#c0575a] dark:text-[#e4a0a0]">
          Subtotal est.
        </div>
        <div className="text-2xl font-bold tabular-nums">
          {subtotal > 0 ? formatMoney(subtotal) : '—'}
        </div>
      </div>
    </div>
  )
}
