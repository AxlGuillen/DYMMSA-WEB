/**
 * Finanzas — facturas por pagar (issue #84, fase 1).
 *
 * Matemática pura del overview de egresos: vencimiento pre-llenado desde el
 * plazo del proveedor y resumen del mes (pendiente/vencido/por vencer/pagado,
 * con las pendientes agrupadas por semana de vencimiento). Como en format.ts,
 * el reloj SIEMPRE se inyecta por parámetro — nada aquí lee `new Date()`.
 *
 * Fase 2 (pendiente): el lado de los ingresos para proyectar el cierre ± del
 * mes y simular mover pagos entre meses.
 */

import type { Payable, PayableStatus } from '@/types/database'

export const PAYABLE_STATUS_LABELS: Record<PayableStatus, string> = {
  pending: 'Pendiente',
  paid: 'Pagada',
  cancelled: 'Cancelada',
}

/** Fechas como 'YYYY-MM-DD' (columnas `date` de Postgres — sin zona horaria). */
export type ISODate = string

/** Suma días de plazo a la fecha de factura. Aritmética UTC: sin saltos de DST. */
export function dueDateFrom(invoiceDate: ISODate, termsDays: number | null | undefined): ISODate {
  const days = Number.isInteger(termsDays) && (termsDays as number) > 0 ? (termsDays as number) : 0
  const base = new Date(`${invoiceDate}T00:00:00Z`)
  if (Number.isNaN(base.getTime())) return invoiceDate
  base.setUTCDate(base.getUTCDate() + days)
  return base.toISOString().slice(0, 10)
}

/** 'YYYY-MM' del mes de una fecha ISO. */
export const monthOf = (date: ISODate): string => date.slice(0, 7)

/** Frontera EXCLUSIVA del mes ('2026-09' → '2026-10-01'); `${month}-31` no existe en meses cortos. */
export function nextMonth(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`
}

/** Semana del mes (1-based) por día del vencimiento: 1-7 → 1, 8-14 → 2, etc. */
export function weekOfMonth(date: ISODate): number {
  const day = Number(date.slice(8, 10))
  return Math.min(Math.ceil(day / 7), 5)
}

export interface PayablesWeekBucket {
  /** 1..5 dentro del mes. */
  week: number
  label: string
  total: number
  count: number
}

export interface PayablesMonthSummary {
  /** Pendientes que VENCEN dentro del mes seleccionado. */
  pendingTotal: number
  pendingCount: number
  /** Pendientes ya vencidas a `today` (de este mes o arrastradas de meses previos). */
  overdueTotal: number
  overdueCount: number
  /** Pendientes que vencen en los próximos 7 días desde `today` (sin importar el mes). */
  dueSoonTotal: number
  dueSoonCount: number
  /** Pagadas con `paid_at` dentro del mes seleccionado. */
  paidTotal: number
  paidCount: number
  /** Pendientes del mes agrupadas por semana de vencimiento (solo semanas con algo). */
  weeks: PayablesWeekBucket[]
}

/**
 * Resumen del mes para el overview. `month` = 'YYYY-MM'; `today` = ISODate.
 * Las canceladas no cuentan en nada.
 */
export function summarizeMonth(
  payables: readonly Payable[],
  month: string,
  today: ISODate,
): PayablesMonthSummary {
  const soonLimit = dueDateFrom(today, 7)
  const weekMap = new Map<number, PayablesWeekBucket>()

  const summary: PayablesMonthSummary = {
    pendingTotal: 0, pendingCount: 0,
    overdueTotal: 0, overdueCount: 0,
    dueSoonTotal: 0, dueSoonCount: 0,
    paidTotal: 0, paidCount: 0,
    weeks: [],
  }

  for (const p of payables) {
    if (p.status === 'cancelled') continue

    if (p.status === 'paid') {
      if (p.paid_at && monthOf(p.paid_at) === month) {
        summary.paidTotal += p.amount
        summary.paidCount += 1
      }
      continue
    }

    // Pendiente: vencida a hoy cuenta SIEMPRE (aunque venga de meses previos).
    if (p.due_date < today) {
      summary.overdueTotal += p.amount
      summary.overdueCount += 1
    } else if (p.due_date <= soonLimit) {
      summary.dueSoonTotal += p.amount
      summary.dueSoonCount += 1
    }

    if (monthOf(p.due_date) === month) {
      summary.pendingTotal += p.amount
      summary.pendingCount += 1
      const week = weekOfMonth(p.due_date)
      const bucket = weekMap.get(week) ?? { week, label: `Semana ${week}`, total: 0, count: 0 }
      bucket.total += p.amount
      bucket.count += 1
      weekMap.set(week, bucket)
    }
  }

  summary.weeks = [...weekMap.values()].sort((a, b) => a.week - b.week)
  return summary
}

/** Días entre hoy y el vencimiento (negativo = vencida). Para el tono de la celda. */
export function daysUntilDue(dueDate: ISODate, today: ISODate): number {
  const due = new Date(`${dueDate}T00:00:00Z`).getTime()
  const now = new Date(`${today}T00:00:00Z`).getTime()
  return Math.round((due - now) / 86_400_000)
}
