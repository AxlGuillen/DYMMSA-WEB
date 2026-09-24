/**
 * Month closing (#94/#109): the app's egresos + Odoo's ingresos, same math as the overview.
 * Odoo missing or failing degrades to egresos only — the tool never fails for that (ADR-027).
 */

import { ToolError, type Db } from '../shared'
import { todayInMexico } from '@/lib/format'
import { ISO_MONTH, monthRange } from '@/lib/month'
import { summarizeMonth } from '@/lib/payables'
import { buildIncomeOverview, INCOME_UNAVAILABLE_MESSAGES, monthClosing } from '@/lib/income'
import { OdooError } from '@/lib/odoo/client'
import { isOdooConfigured } from '@/lib/odoo/env'
import { cachedMonthCollections, cachedOpenCustomerMoves } from '@/lib/odoo/income-cache'
import type { Payable } from '@/types/database'

const EGRESOS_LIMIT = 1000

type IncomeSources = {
  collections: Parameters<typeof buildIncomeOverview>[2]
  open: Parameters<typeof buildIncomeOverview>[3]
}

/** Injected so tests never touch the Data Cache or Odoo. */
export interface IncomeDeps {
  configured: () => boolean
  load: (month: string) => Promise<IncomeSources>
}

const liveIncome: IncomeDeps = {
  configured: isOdooConfigured,
  load: async (month) => {
    const [collections, open] = await Promise.all([cachedMonthCollections(month), cachedOpenCustomerMoves()])
    return { collections, open }
  },
}

async function readIncome(month: string, today: string, deps: IncomeDeps) {
  if (!deps.configured()) return { income: null, motivo: INCOME_UNAVAILABLE_MESSAGES.not_configured }
  try {
    const { collections, open } = await deps.load(month)
    return { income: buildIncomeOverview(month, today, collections, open), motivo: null }
  } catch (error) {
    if (!(error instanceof OdooError)) throw error
    return { income: null, motivo: INCOME_UNAVAILABLE_MESSAGES.odoo_error }
  }
}

export async function getMonthClosing(db: Db, input: { mes?: string } = {}, deps: IncomeDeps = liveIncome) {
  const today = todayInMexico()
  const month = input.mes ?? today.slice(0, 7)
  if (!ISO_MONTH.test(month)) throw new ToolError('Mes inválido — usa YYYY-MM')
  const { from, toExclusive } = monthRange(month)

  // Same cap as the overview; a silent cut would move cierre.real, so it is reported.
  const [pendingRes, paidRes, incomeRes] = await Promise.all([
    db.from('payables').select('*', { count: 'exact' }).eq('status', 'pending').limit(EGRESOS_LIMIT),
    db
      .from('payables')
      .select('*', { count: 'exact' })
      .eq('status', 'paid')
      .gte('paid_at', from)
      .lt('paid_at', toExclusive)
      .limit(EGRESOS_LIMIT),
    readIncome(month, today, deps),
  ])
  if (pendingRes.error || paidRes.error) {
    throw new ToolError(`Error al leer los egresos: ${(pendingRes.error ?? paidRes.error)?.message}`)
  }
  const egresos = summarizeMonth([...(pendingRes.data ?? []), ...(paidRes.data ?? [])] as Payable[], month, today)
  const egresosTruncados = (pendingRes.count ?? 0) > EGRESOS_LIMIT || (paidRes.count ?? 0) > EGRESOS_LIMIT
  const summary = incomeRes.income?.income ?? null
  const cierre = monthClosing({
    collected: summary?.collectedTotal ?? 0,
    paid: egresos.paidTotal,
    pending: egresos.pendingTotal,
    carryOver: egresos.carryOverTotal,
  })

  return {
    mes: month,
    hoy: today,
    egresos: {
      pagado: egresos.paidTotal,
      pendiente_del_mes: egresos.pendingTotal,
      vencido_de_meses_anteriores: egresos.carryOverTotal,
      truncado: egresosTruncados,
      nota: egresosTruncados ? `Lectura truncada a ${EGRESOS_LIMIT} facturas por estado: los egresos y el cierre pueden quedar cortos.` : null,
    },
    ingresos: summary
      ? {
          cobrado: summary.collectedTotal,
          cobros: summary.collectedCount,
          por_cobrar: summary.receivableTotal,
          vencido_por_cobrar: summary.overdueTotal,
          // Customer credit, never netted against the receivables (#102).
          notas_credito_sin_aplicar: summary.creditNotesTotal,
          monedas_extranjeras: [...new Set([...summary.collectionCurrencies, ...summary.receivableCurrencies])],
          truncado: summary.collectionsTruncated || summary.receivablesTruncated,
        }
      : null,
    ingresos_no_disponibles: incomeRes.motivo,
    cierre: {
      real: cierre.real,
      proyectado: cierre.projected,
      formula: 'real = cobrado − pagado; proyectado = real − pendiente del mes − vencido de meses anteriores',
      nota: summary ? null : 'Sin ingresos de Odoo el cierre solo refleja egresos.',
    },
  }
}
