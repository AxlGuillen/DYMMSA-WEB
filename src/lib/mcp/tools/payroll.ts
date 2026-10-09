/**
 * Payroll (#123, ADR-033): the cut and the draft write that loads the workshop sheet.
 * No permission logic here: the db carries the caller's token and every payroll table is
 * `is_admin()` — a member reads nothing and writes nothing.
 */

import { ToolError, requireSingleMatch, type Db } from '../shared'
import { resolvePerson } from './profiles'
import { todayInMexico } from '@/lib/format'
import { formatDuration, SHIFT_LABELS } from '@/lib/timesheet'
import { PERIOD_DAY_LABELS, isIsoDate, parseEmployeeInput, payrollPeriod, type HoursBreakdown } from '@/lib/payroll'
import {
  PayrollError,
  createEmployee,
  loadEmployees,
  loadPayrollView,
  prefillFromHours,
  saveDays,
  updateEmployee,
  type DayInput,
} from '@/lib/payroll-store'
import type { PayrollEmployee, Profile, ProfileShift } from '@/types/database'

const NO_ACCESS = 'Sin empleados visibles: Nómina solo la ve un administrador, y los empleados se dan de alta con save_payroll_employee (o en la app, Nómina → Empleados).'

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
      jornada: SHIFT_LABELS[row.employee.shift],
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
  dias?: {
    empleado: string
    fecha: string
    /** Hours worked that day, decimals allowed (8, 11.5). */
    horas: number
    horas_no_trabajadas?: number
    nota?: string
  }[]
  /** "Traer de Horas" (#132): copies the office's clocked hours of the cut instead of `dias`. */
  traer_de_horas?: boolean
  /** Any day of the cut for `traer_de_horas` (default: the current one). */
  fecha?: string
}

const toMinutes = (hours: number) => Math.round(hours * 60)

/** Saves the sheet as DRAFTS. Confirming and closing stay in the app, with the admin. */
export async function recordPayrollHours(db: Db, input: RecordPayrollHoursInput) {
  if (input.traer_de_horas) {
    if (input.dias?.length) throw new ToolError('Usa `dias` o `traer_de_horas`, no los dos en la misma llamada')
    return prefillCut(db, input.fecha)
  }
  if (input.fecha !== undefined) throw new ToolError('`fecha` solo aplica con `traer_de_horas`; con `dias`, cada día lleva la suya')
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
    // Same rule as prefillFromHours: a 0-hour draft would be frozen by "confirm all" (review PR #129).
    if (d.horas === 0 && missed === 0) {
      throw new ToolError(`${d.empleado} el ${d.fecha}: un día sin horas no se carga — si no trabajó, no lo mandes`)
    }
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

/** Same rules as the app's button: drafts only, never over a confirmed day, another source or a closed cut. */
async function prefillCut(db: Db, fecha?: string) {
  if (fecha !== undefined && !isIsoDate(fecha)) throw new ToolError('Fecha inválida — usa YYYY-MM-DD')
  const { start, end } = payrollPeriod(fecha ?? todayInMexico())
  const employees = await loadEmployees(db)
  // A member reads zero employees by RLS: say so instead of sending them to a screen they cannot open (review PR #138).
  if (employees.length === 0) throw new ToolError(NO_ACCESS)
  const result = await asTool(() => prefillFromHours(db, start))
  const byId = new Map(employees.map((e) => [e.id, e.name]))
  return {
    corte: { inicio: start, fin: end },
    empleados_ligados: result.linked,
    guardados: result.saved,
    omitidos: result.skipped.map((s) => ({ empleado: byId.get(s.employee_id) ?? s.employee_id, fecha: s.work_date, motivo: s.reason })),
    checadas_sin_salida: result.open,
    nota:
      result.linked === 0
        ? 'Ningún empleado de nómina está ligado a un perfil de la app: se liga en Nómina → Empleados.'
        : 'Quedaron como BORRADOR y todavía no suman: un administrador los revisa y confirma en la app. Una checada sin salida no suma: corrígela en Horas y vuelve a traer.',
  }
}

export interface SavePayrollEmployeeInput {
  /** The employee to edit (name or part of it); absent = a new one. */
  empleado?: string
  nombre?: string
  jornada?: 'completa' | 'media'
  /** App profile to link, by name; null or "" unlinks. */
  perfil?: string | null
  /** false = the leave (never a delete: the days keep their employee). */
  activo?: boolean
}

const SHIFTS: Record<NonNullable<SavePayrollEmployeeInput['jornada']>, ProfileShift> = { completa: 'full_time', media: 'part_time' }

/** Creates or edits a payroll employee with the routes' rules (#134); confirming and closing stay in the app (ADR-033). */
export async function savePayrollEmployee(db: Db, callerId: string, input: SavePayrollEmployeeInput) {
  const editing = Boolean(input.empleado?.trim())
  const employees = editing ? await loadEmployees(db) : []
  if (editing && employees.length === 0) throw new ToolError(NO_ACCESS)
  const target = editing ? resolveEmployee(employees, input.empleado as string) : null

  // "" must unlink, never fall into resolvePerson's "no name = the caller".
  const unlink = input.perfil === null || (typeof input.perfil === 'string' && !input.perfil.trim())
  const person = input.perfil && !unlink ? await resolvePerson<Pick<Profile, 'id' | 'display_name'>>(db, callerId, input.perfil, 'id, display_name') : null

  const fields: Record<string, unknown> = {
    name: input.nombre,
    shift: input.jornada ? SHIFTS[input.jornada] : undefined,
    profile_id: unlink ? null : person?.id,
    active: input.activo,
  }
  const parsed = parseEmployeeInput(Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)), { requireName: !editing })
  if ('error' in parsed) throw new ToolError(parsed.error)
  if (editing && Object.keys(parsed.value).length === 0) throw new ToolError('No hay cambios: indica nombre, jornada, perfil o activo.')

  const saved = target
    ? await asTool(() => updateEmployee(db, target.id, parsed.value))
    : await asTool(() => createEmployee(db, parsed.value))
  if (!saved) throw new ToolError(NO_ACCESS)

  let linked = person?.display_name ?? null
  if (!linked && saved.profile_id) {
    const { data } = await db.from('profiles').select('display_name').eq('id', saved.profile_id).maybeSingle()
    linked = (data as { display_name: string } | null)?.display_name ?? null
  }
  return {
    accion: target ? 'actualizado' : 'creado',
    empleado: { nombre: saved.name, jornada: SHIFT_LABELS[saved.shift], perfil_ligado: linked, activo: saved.active },
    nota: !saved.active
      ? 'Dado de baja: sus horas guardadas se conservan y ya no recibe horas nuevas de la hoja.'
      : target
        ? 'Guardado.'
        : 'Dado de alta: ya puede recibir horas con record_payroll_hours.',
  }
}
