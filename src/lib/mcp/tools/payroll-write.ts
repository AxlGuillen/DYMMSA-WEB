/**
 * The money steps of payroll through the assistant (#155 D, ADR-033 §9 reopened): confirming drafts, closing and
 * reopening the cut (save_payroll_period) and correcting one confirmed day (save_payroll_hours.corregir). Always
 * two phases: «un 3.5 mal leído es dinero», so the summary shows exactly what turns into payable hours and the key
 * binds to it. Hours, never amounts. The rules live in payroll-store.ts, shared with the routes.
 */

import type { WritePlan } from '@/lib/mcp/core/define'
import { diff, writeResult } from '@/lib/mcp/core/envelope'
import { ToolError } from '@/lib/mcp/core/errors'
import type { Db } from '@/lib/mcp/core/db'
import { todayInMexico } from '@/lib/format'
import { buildPayrollView, isIsoDate, payrollPeriod, type PayrollView } from '@/lib/payroll'
import {
  confirmDrafts,
  loadPayrollInputs,
  saveTypedDay,
  setPeriodClosed,
  type DayInput,
  type PayrollInputs,
} from '@/lib/payroll-store'
import { formatDuration } from '@/lib/timesheet'
import type { PayrollDay } from '@/types/database'
import { resolveEmployee as resolvePayrollEmployee, SOURCE_LABELS } from './payroll'

const toMinutes = (hours: number) => Math.round(hours * 60)
const hoursText = (minutes: number) => formatDuration(minutes)

function header(view: PayrollView) {
  return { inicio: view.start, fin: view.end, estado: view.closed ? 'cerrado' : 'abierto', borradores: view.drafts }
}

const viewOf = (start: string, inputs: PayrollInputs, days: readonly PayrollDay[] = inputs.days) =>
  buildPayrollView(start, inputs.employees, days, inputs.period, inputs.areas)

// ── save_payroll_period ───────────────────────────────────────────────────────

export const PERIOD_ACTIONS = ['confirmar_borradores', 'cerrar', 'reabrir'] as const
export type PeriodAction = (typeof PERIOD_ACTIONS)[number]

export interface SavePayrollPeriodInput {
  accion: PeriodAction
  /** Any day of the cut; default the current one. */
  fecha?: string
}

type PeriodCarry = { start: string; action: PeriodAction; draftIds: string[] }

/** The most drafts the summary spells out; the rest are counted, and the key still binds to all of them. */
const DRAFTS_SHOWN = 80

type DraftLine = { empleado: string; fecha: string; horas: string; no_trabajadas?: string; origen: string; nota?: string }

function draftsOf(view: PayrollView): { day: PayrollDay; line: DraftLine }[] {
  return view.rows.flatMap((row) =>
    row.days.flatMap((day) =>
      day?.status === 'draft'
        ? [{
            day,
            line: {
              empleado: row.employee.name,
              fecha: day.work_date,
              horas: hoursText(day.worked_minutes),
              ...(day.missed_minutes > 0 ? { no_trabajadas: hoursText(day.missed_minutes) } : {}),
              origen: SOURCE_LABELS[day.source],
              ...(day.note ? { nota: day.note } : {}),
            },
          }]
        : [],
    ),
  )
}

export async function planSavePayrollPeriod(db: Db, input: SavePayrollPeriodInput): Promise<WritePlan<PeriodCarry>> {
  if (input.fecha !== undefined && !isIsoDate(input.fecha)) throw new ToolError('Fecha inválida — usa YYYY-MM-DD')
  const { start } = payrollPeriod(input.fecha ?? todayInMexico())
  const inputs = await loadPayrollInputs(db, start)
  const view = viewOf(start, inputs)
  const subject = `El corte del ${view.start} al ${view.end}`
  const base = { subject, carry: { start, action: input.accion, draftIds: [] as string[] } }

  if (input.accion === 'confirmar_borradores') {
    const drafts = draftsOf(view).sort((a, b) => a.day.id.localeCompare(b.day.id))
    if (drafts.length === 0) {
      return { ...base, entity: { key: 'corte', value: header(view) }, avisos: ['No hay borradores en este corte.'], sinCambios: true, fingerprint: null }
    }
    // What counts after: the same cut with every draft turned confirmed, through the pure builder.
    const after = viewOf(start, inputs, inputs.days.map((d) => (d.status === 'draft' ? { ...d, status: 'confirmed' as const } : d)))
    const avisos = [
      `Se confirman ${drafts.length} días en borrador: empiezan a sumar al corte y las cargas automáticas ya no los pisan.`,
      `Total equivalente del corte: ${hoursText(view.totals.equivalent)} → ${hoursText(after.totals.equivalent)}.`,
    ]
    if (drafts.length > DRAFTS_SHOWN) avisos.push(`La lista muestra los primeros ${DRAFTS_SHOWN} de ${drafts.length}; la clave cubre todos.`)
    return {
      ...base,
      entity: { key: 'corte', value: { ...header(view), por_confirmar: drafts.slice(0, DRAFTS_SHOWN).map((d) => d.line) } },
      avisos,
      // The key binds to the exact drafts shown: a new, changed or deleted draft voids it.
      fingerprint: drafts.map(({ day }) => [day.id, day.worked_minutes, day.missed_minutes, day.note, day.updated_at]),
      carry: { start, action: input.accion, draftIds: drafts.map((d) => d.day.id) },
    }
  }

  if (input.accion === 'cerrar') {
    if (view.closed) {
      const by = view.period?.closed_by_name
      return { ...base, entity: { key: 'corte', value: header(view) }, avisos: [`El corte ya está cerrado${by ? ` (lo cerró ${by})` : ''}.`], sinCambios: true, fingerprint: null }
    }
    return {
      ...base,
      entity: {
        key: 'corte',
        value: {
          ...header(view),
          empleados: view.rows.map((row) => ({ nombre: row.employee.name, equivalente: hoursText(row.totals.equivalent) })),
          total_equivalente: hoursText(view.totals.equivalent),
        },
      },
      avisos: ['Congela el corte: nadie puede cambiar sus días, y la jornada y el área de cada empleado quedan fijas. Se revierte con `reabrir`.'],
      bloqueos: view.drafts > 0 ? [`Hay ${view.drafts} días en borrador: confírmalos (confirmar_borradores) o bórralos antes de cerrar.`] : undefined,
      fingerprint: { cerrado: view.closed, dias: inputs.days.map((d) => [d.id, d.status, d.worked_minutes, d.updated_at]).sort() },
    }
  }

  // reabrir
  if (!view.closed) {
    return { ...base, entity: { key: 'corte', value: header(view) }, avisos: ['El corte no está cerrado: no hay nada que reabrir.'], sinCambios: true, fingerprint: null }
  }
  return {
    ...base,
    entity: { key: 'corte', value: { ...header(view), cerrado_por: view.period?.closed_by_name ?? null, cerrado_el: view.period?.closed_at ?? null } },
    avisos: ['Descongela un corte que puede estar ya pagado. Queda anotado quién lo reabrió, sin más bitácora.'],
    fingerprint: { cerrado: view.closed, closed_at: view.period?.closed_at ?? null },
  }
}

/** The signed-in admin's display name, which the period stamps (a snapshot, as the app's button sends it). */
async function actorName(db: Db, userId: string): Promise<string | null> {
  const { data } = await db.from('profiles').select('display_name').eq('id', userId).maybeSingle()
  return (data as { display_name: string } | null)?.display_name ?? null
}

export async function commitSavePayrollPeriod(db: Db, userId: string, plan: WritePlan<PeriodCarry>) {
  const { start, action, draftIds } = plan.carry
  if (action === 'confirmar_borradores') {
    const confirmed = await confirmDrafts(db, start, draftIds)
    const avisos = [...(plan.avisos ?? [])]
    if (confirmed !== draftIds.length) avisos.push(`Se confirmaron ${confirmed} de ${draftIds.length}: el resto cambió al confirmar.`)
    return writeResult('actualizado', 'corte', { ...(plan.entity.value as object), confirmados: confirmed }, { avisos })
  }
  const period = await setPeriodClosed(db, start, action === 'cerrar', await actorName(db, userId))
  return writeResult('actualizado', 'corte', { ...(plan.entity.value as object), estado: period.status === 'closed' ? 'cerrado' : 'abierto' }, { avisos: plan.avisos })
}

// ── save_payroll_hours.corregir ───────────────────────────────────────────────

export interface CorrectDayInput {
  empleado: string
  fecha: string
  /** 0 with no note deletes the day, like the empty cell. */
  horas: number
  horas_no_trabajadas?: number
  /** '' clears it; omitted keeps the one it had. */
  nota?: string
}

export type CorrectCarry = { kind: 'corregir'; day: DayInput; deleting: boolean; employee: string }

function dayView(day: Pick<PayrollDay, 'worked_minutes' | 'missed_minutes' | 'note' | 'status' | 'source'> | null) {
  return day
    ? {
        horas: hoursText(day.worked_minutes),
        no_trabajadas: day.missed_minutes > 0 ? hoursText(day.missed_minutes) : null,
        estado: day.status === 'draft' ? 'borrador' : 'confirmado',
        origen: SOURCE_LABELS[day.source],
        nota: day.note,
      }
    : null
}

export async function planCorrectDay(db: Db, input: CorrectDayInput): Promise<WritePlan<CorrectCarry>> {
  if (!isIsoDate(input.fecha)) throw new ToolError(`Fecha inválida: "${input.fecha}" — usa YYYY-MM-DD`)
  for (const [label, hours] of [['horas', input.horas], ['horas_no_trabajadas', input.horas_no_trabajadas ?? 0]] as const) {
    if (!Number.isFinite(hours) || hours < 0 || hours > 24) throw new ToolError(`${label} inválidas (0 a 24)`)
  }
  const { start } = payrollPeriod(input.fecha)
  const inputs = await loadPayrollInputs(db, start)
  // Every employee, active or not: a cut of someone who left can still be corrected (the app's cell can).
  if (inputs.employees.length === 0) throw new ToolError('Sin empleados visibles: Nómina solo la ve un administrador.')
  const employee = resolvePayrollEmployee(inputs.employees, input.empleado)
  const before = inputs.days.find((d) => d.employee_id === employee.id && d.work_date === input.fecha) ?? null

  const worked = toMinutes(input.horas)
  // An omitted figure keeps what the day had, but a plain 0 hours is the way to empty it (no note, no missed hours).
  const missed = input.horas_no_trabajadas === undefined ? (worked === 0 ? 0 : (before?.missed_minutes ?? 0)) : toMinutes(input.horas_no_trabajadas)
  const note = input.nota === undefined ? (worked === 0 && missed === 0 ? null : (before?.note ?? null)) : input.nota.trim() || null
  const deleting = worked === 0 && missed === 0 && !note
  const day: DayInput = { employee_id: employee.id, work_date: input.fecha, worked_minutes: worked, missed_minutes: missed, note }

  const avisos: string[] = []
  const bloqueos: string[] = []
  if (inputs.period?.status === 'closed') {
    bloqueos.push(`El corte del ${start} está cerrado: reábrelo primero (save_payroll_period, accion reabrir).`)
  }
  if (before?.status === 'draft') avisos.push('Era un borrador: al corregirlo queda confirmado.')

  const nextDay: PayrollDay | null = deleting
    ? null
    : { ...(before ?? { id: 'nuevo', shift_snapshot: null, area_snapshot: null, created_at: '', updated_at: '' }), employee_id: employee.id, work_date: input.fecha, worked_minutes: worked, missed_minutes: missed, note, source: 'manual', status: 'confirmed' }
  const others = inputs.days.filter((d) => !(d.employee_id === employee.id && d.work_date === input.fecha))
  const rowOf = (view: PayrollView) => view.rows.find((r) => r.employee.id === employee.id)
  const totalBefore = rowOf(viewOf(start, inputs))?.totals.equivalent ?? 0
  const totalAfter = rowOf(viewOf(start, inputs, nextDay ? [...others, nextDay] : others))?.totals.equivalent ?? 0
  avisos.push(
    deleting
      ? `Se borra el día. Total equivalente de ${employee.name} en el corte: ${hoursText(totalBefore)} → ${hoursText(totalAfter)}.`
      : `Queda confirmado y manual: suma de inmediato y las cargas automáticas ya no lo pisan. Total equivalente de ${employee.name} en el corte: ${hoursText(totalBefore)} → ${hoursText(totalAfter)}.`,
  )

  const shown = dayView(before)
  const next = nextDay ? dayView(nextDay) : null
  return {
    entity: { key: 'dia', value: { empleado: employee.name, fecha: input.fecha, ...(next ?? { horas: '00:00', estado: 'sin registro' }) } },
    cambios: diff({ dia: shown }, { dia: next }),
    avisos,
    bloqueos: bloqueos.length > 0 ? bloqueos : undefined,
    // Nothing to delete, or the day already is exactly this, confirmed and typed by hand.
    sinCambios:
      (!before && deleting) ||
      (before !== null && !deleting && before.status === 'confirmed' && before.source === 'manual' && before.worked_minutes === worked && before.missed_minutes === missed && before.note === note),
    fingerprint: {
      empleado: employee.id,
      fecha: input.fecha,
      cerrado: inputs.period?.status === 'closed',
      dia: before ? [before.id, before.worked_minutes, before.missed_minutes, before.note, before.status, before.source, before.updated_at] : null,
      total: totalBefore,
    },
    subject: `El día ${input.fecha} de ${employee.name}`,
    carry: { kind: 'corregir', day, deleting, employee: employee.name },
  }
}

export async function commitCorrectDay(db: Db, plan: WritePlan<CorrectCarry>) {
  const { day, deleting } = plan.carry
  await saveTypedDay(db, day)
  return writeResult(deleting ? 'borrado' : 'actualizado', 'dia', plan.entity.value, { cambios: plan.cambios, avisos: plan.avisos })
}
