/**
 * Payroll (#123, ADR-033): the cut and the draft write that loads the workshop sheet.
 * No permission logic here: the db carries the caller's token and every payroll table is
 * `is_admin()` — a member reads nothing and writes nothing.
 */

import { ToolError, requireSingleMatch, type Db } from '../shared'
import { todayInMexico } from '@/lib/format'
import { formatDuration } from '@/lib/timesheet'
import { PERIOD_DAY_LABELS, isIsoDate, payrollPeriod, type HoursBreakdown } from '@/lib/payroll'
import { PayrollError, loadEmployees, loadPayrollView, saveDays, type DayInput } from '@/lib/payroll-store'
import type { PayrollEmployee } from '@/types/database'

const NO_ACCESS = 'Sin empleados visibles: Nómina solo la ve un administrador, y los empleados se dan de alta en la app (Nómina → Empleados).'

const SOURCE_LABELS = { sheet: 'hoja', hours: 'checador', manual: 'manual' } as const

/** PayrollError is a broken rule the user can fix: it must reach the model verbatim. */
async function asTool<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (error) {
    if (error instanceof PayrollError) throw new ToolError(error.message)
    throw error
  }
}

function totals(t: HoursBreakdown) {
  return {
    normal: formatDuration(t.regular),
    extra: formatDuration(t.extra),
    sabado: formatDuration(t.saturday),
    domingo: formatDuration(t.sunday),
    equivalente: formatDuration(t.equivalent),
  }
}

export async function getPayrollPeriod(db: Db, input: { fecha?: string } = {}) {
  if (input.fecha !== undefined && !isIsoDate(input.fecha)) throw new ToolError('Fecha inválida — usa YYYY-MM-DD')
  const { start } = payrollPeriod(input.fecha ?? todayInMexico())
  const view = await asTool(() => loadPayrollView(db, start))

  return {
    corte: {
      inicio: view.start,
      fin: view.end,
      cerrado: view.closed,
      cerrado_por: view.closed ? (view.period?.closed_by_name ?? null) : null,
    },
    reglas: 'Lunes a viernes: normal hasta la jornada (8 h, o 4 h en medio tiempo) y el resto extra, ambas ×1. Sábado ×2, domingo ×3. Solo los días confirmados suman; los borradores no.',
    borradores: view.drafts,
    nota: view.rows.length === 0 ? NO_ACCESS : null,
    total: totals(view.totals),
    empleados: view.rows.map((row) => ({
      nombre: row.employee.name,
      tipo: row.employee.profile_id ? 'oficina' : 'taller',
      ...totals(row.totals),
      no_trabajadas: formatDuration(row.missedMinutes),
      dias: row.days.flatMap((day, i) =>
        day
          ? [{
              dia: PERIOD_DAY_LABELS[i],
              fecha: day.work_date,
              horas: formatDuration(day.worked_minutes),
              no_trabajadas: day.missed_minutes > 0 ? formatDuration(day.missed_minutes) : null,
              estado: day.status === 'draft' ? 'borrador' : 'confirmado',
              origen: SOURCE_LABELS[day.source],
              nota: day.note,
            }]
          : [],
      ),
    })),
  }
}

const fold = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

function resolveEmployee(employees: readonly PayrollEmployee[], name: string): PayrollEmployee {
  const query = fold(name)
  if (!query) throw new ToolError('Indica el nombre del empleado')
  // An exact name wins: "Juan" must not be ambiguous because "Juan Carlos" exists.
  const exact = employees.filter((e) => fold(e.name) === query)
  const matches = exact.length > 0 ? exact : employees.filter((e) => fold(e.name).includes(query))
  return requireSingleMatch(matches, (e) => e.name, 'empleado de nómina', name.trim())
}

export interface RecordPayrollHoursInput {
  dias: {
    empleado: string
    fecha: string
    /** Hours worked that day, decimals allowed (8, 11.5). */
    horas: number
    horas_no_trabajadas?: number
    nota?: string
  }[]
}

const toMinutes = (hours: number) => Math.round(hours * 60)

/** Saves the sheet as DRAFTS. Confirming and closing stay in the app, with the admin. */
export async function recordPayrollHours(db: Db, input: RecordPayrollHoursInput) {
  if (!input.dias?.length) throw new ToolError('Indica al menos un día')
  if (input.dias.length > 200) throw new ToolError('Máximo 200 días por llamada')

  const employees = (await loadEmployees(db)).filter((e) => e.active)
  if (employees.length === 0) throw new ToolError(NO_ACCESS)

  const byId = new Map(employees.map((e) => [e.id, e]))
  const days: DayInput[] = input.dias.map((d) => {
    if (!isIsoDate(d.fecha)) throw new ToolError(`Fecha inválida: "${d.fecha}" — usa YYYY-MM-DD`)
    if (!Number.isFinite(d.horas) || d.horas < 0 || d.horas > 24) throw new ToolError(`Horas inválidas para ${d.empleado} el ${d.fecha} (0 a 24)`)
    const missed = d.horas_no_trabajadas ?? 0
    if (!Number.isFinite(missed) || missed < 0 || missed > 24) throw new ToolError(`Horas no trabajadas inválidas para ${d.empleado} el ${d.fecha} (0 a 24)`)
    return {
      employee_id: resolveEmployee(employees, d.empleado).id,
      work_date: d.fecha,
      worked_minutes: toMinutes(d.horas),
      // Omitted = keep what the day already had; the sheet does not always carry it.
      ...(d.horas_no_trabajadas === undefined ? {} : { missed_minutes: toMinutes(missed) }),
      ...(d.nota === undefined ? {} : { note: d.nota }),
    }
  })

  const result = await asTool(() => saveDays(db, days, { source: 'sheet', status: 'draft', overwrite: false }))
  const cortes = [...new Set(days.map((d) => payrollPeriod(d.work_date).start))].sort()
  return {
    guardados: result.saved,
    omitidos: result.skipped.map((s) => ({
      empleado: byId.get(s.employee_id)?.name ?? s.employee_id,
      fecha: s.work_date,
      motivo: s.reason,
    })),
    cortes: cortes.map((start) => ({ inicio: start, fin: payrollPeriod(start).end })),
    nota: 'Quedaron como BORRADOR y todavía no suman: un administrador los revisa y confirma en la app (Nómina → Confirmar borradores).',
  }
}
