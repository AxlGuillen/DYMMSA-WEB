/**
 * delete_record (#155 C6, ADR-041 §4): the one delete of the connector. Always two phases: the summary says what is
 * lost, and a record something else depends on is blocked with the count. Quotations, orders, products, inventory and
 * the catalog are not here on purpose.
 */

import type { WritePlan } from '@/lib/mcp/core/define'
import { refOf, writeResult } from '@/lib/mcp/core/envelope'
import { ToolError } from '@/lib/mcp/core/errors'
import { resolveByName } from '@/lib/mcp/core/lookup'
import type { Db } from '@/lib/mcp/core/db'
import { parsePresentationInput } from '@/lib/cut-plan'
import { deleteExcusedDay, findExcusedDay } from '@/lib/excused-days-store'
import { deleteMaterialPresentation, findPresentation } from '@/lib/materials-store'
import { deletePayable } from '@/lib/payables-store'
import { todayInMexico } from '@/lib/format'
import {
  brandInUse,
  countBrandSuppliers,
  countSupplierPayables,
  deleteBrand,
  deleteSupplier,
  SUPPLIER_HAS_PAYABLES,
} from '@/lib/suppliers-store'
import { deleteTimeEntry } from '@/lib/time-entries-store'
import { EXCUSE_TOKENS, formatDuration, isRealDate, minutesBetween, normalizeTime } from '@/lib/timesheet'
import type { Profile } from '@/types/database'
import { describePresentation } from './cutting'
import { entriesBetween } from './hours'
import { digest, resolvePayable } from './payables'
import { resolvePerson } from './profiles'
import { resolveSupplier } from './suppliers'

export const RECORD_TYPES = ['proveedor', 'marca', 'medida', 'factura', 'checada', 'dia_justificado'] as const
export type RecordType = (typeof RECORD_TYPES)[number]

export interface DeleteRecordInput {
  tipo: RecordType
  /** proveedor, marca or factura: ref or name. */
  referencia?: string
  /** checada (default: the caller) or dia_justificado (omitted = the whole team). */
  persona?: string
  fecha?: string
  /** checada: its clock-in as it is now (HH:MM). */
  entrada?: string
  /** medida: material and mm, as save_material_presentation takes them. */
  material?: 'tubo' | 'placa'
  diametro_mm?: number
  espesor_mm?: number
  ancho_mm?: number
  largo_mm?: number
}

interface Carry {
  tipo: RecordType
  id: string
}

type Found = Omit<WritePlan<Carry>, 'carry' | 'subject' | 'fingerprint'> & { id: string; fingerprint: unknown; subject: string }

function need(input: DeleteRecordInput, what: string): string {
  const value = input.referencia?.trim()
  if (!value) throw new ToolError(`Para borrar ${what} indica \`referencia\` (nombre o ref).`)
  return value
}

async function findSupplier(db: Db, input: DeleteRecordInput): Promise<Found> {
  const supplier = await resolveSupplier(db, need(input, 'un proveedor'))
  const invoices = await countSupplierPayables(db, supplier.id)
  return {
    id: supplier.id,
    entity: { key: 'proveedor', value: { ref: refOf(supplier.id), nombre: supplier.name, facturas_por_pagar: invoices } },
    bloqueos: invoices > 0 ? [`${SUPPLIER_HAS_PAYABLES} (tiene ${invoices}).`] : undefined,
    avisos: ['Se borran también los vínculos con sus marcas; las marcas siguen en el catálogo.'],
    fingerprint: { id: supplier.id, invoices },
    subject: `El proveedor «${supplier.name}»`,
  }
}

async function findBrand(db: Db, input: DeleteRecordInput): Promise<Found> {
  const brand = await resolveByName<{ id: string; name: string }>(
    db,
    { table: 'brands', select: 'id, name', what: 'marca', article: 'la', label: (b) => b.name, nameColumns: ['name'] },
    need(input, 'una marca'),
  )
  const used = await countBrandSuppliers(db, brand.id)
  return {
    id: brand.id,
    entity: { key: 'marca', value: { ref: refOf(brand.id), nombre: brand.name, proveedores: used } },
    bloqueos: used > 0 ? [brandInUse(used)] : undefined,
    fingerprint: { id: brand.id, used },
    subject: `La marca «${brand.name}»`,
  }
}

async function findMeasure(db: Db, input: DeleteRecordInput): Promise<Found> {
  if (!input.material) throw new ToolError('Para borrar una medida indica `material` (tubo o placa) y sus mm, como al registrarla.')
  const parsed = parsePresentationInput({
    material_type: input.material === 'tubo' ? 'tube' : 'plate',
    diameter_mm: input.diametro_mm,
    thickness_mm: input.espesor_mm,
    width_mm: input.ancho_mm,
    length_mm: input.largo_mm,
  })
  if ('error' in parsed) throw new ToolError(parsed.error)
  const found = await findPresentation(db, parsed.value)
  if (!found) throw new ToolError(`No hay registrada ${describePresentation(parsed.value).replace(/^./, (c) => c.toLowerCase())}.`)
  return {
    id: found.id,
    entity: { key: 'medida', value: describePresentation(parsed.value) },
    avisos: ['Si la vuelves a necesitar, se registra de nuevo con save_material_presentation.'],
    fingerprint: { id: found.id },
    subject: 'La medida',
  }
}

async function findPayable(db: Db, input: DeleteRecordInput): Promise<Found> {
  const payable = await resolvePayable(db, need(input, 'una factura'))
  return {
    id: payable.id,
    entity: { key: 'factura', value: digest(payable, todayInMexico()) },
    // A paid one carries the real payment date: it goes back to pending first, as a deliberate step.
    bloqueos:
      payable.status === 'paid'
        ? [`"${payable.concept}" está pagada (el ${payable.paid_at}): regrésala a pendiente con save_payable antes de borrarla.`]
        : undefined,
    fingerprint: { id: payable.id, updated_at: payable.updated_at, status: payable.status, amount: payable.amount },
    subject: `La factura «${payable.concept}»`,
  }
}

async function findPunch(db: Db, userId: string, input: DeleteRecordInput): Promise<Found> {
  if (!input.fecha || !isRealDate(input.fecha)) throw new ToolError('Para borrar una checada indica `fecha` (YYYY-MM-DD).')
  if (!input.entrada) throw new ToolError('Para borrar una checada indica su `entrada` (HH:MM); get_week_hours las lista.')
  const person = await resolvePerson<Pick<Profile, 'id' | 'display_name'>>(db, userId, input.persona, 'id, display_name')
  const day = await entriesBetween(db, person.id, input.fecha, input.fecha)
  const wanted = normalizeTime(input.entrada)
  const entry = day.find((e) => e.clock_in === wanted)
  if (!entry) {
    const seen = day.map((e) => `${e.clock_in}–${e.clock_out ?? 'sin salida'}`).join(', ') || 'ninguna'
    throw new ToolError(`${person.display_name} no tiene una checada con entrada ${input.entrada} el ${input.fecha}. Checadas de ese día: ${seen}`)
  }
  const minutes = minutesBetween(entry.clock_in, entry.clock_out)
  const avisos: string[] = []
  // The clock's own punch comes back when its report is loaded again; a correction made by hand is lost.
  if (entry.source === 'import') avisos.push('Esta checada vino del reporte del checador: si ese reporte se vuelve a cargar, regresa.')
  if (entry.edited_at) avisos.push('Fue corregida a mano: se pierde la corrección.')
  return {
    id: entry.id,
    entity: {
      key: 'checada',
      value: { persona: person.display_name, fecha: entry.work_date, entrada: entry.clock_in, salida: entry.clock_out, horas: minutes === null ? null : formatDuration(minutes) },
    },
    avisos,
    fingerprint: { id: entry.id, clock_in: entry.clock_in, clock_out: entry.clock_out, edited_at: entry.edited_at, note: entry.note },
    subject: `La checada de ${person.display_name} del ${entry.work_date}`,
  }
}

async function findExcused(db: Db, userId: string, input: DeleteRecordInput): Promise<Found> {
  if (!input.fecha || !isRealDate(input.fecha)) throw new ToolError('Para quitar un día justificado indica `fecha` (YYYY-MM-DD).')
  const person = input.persona?.trim() ? await resolvePerson<Pick<Profile, 'id' | 'display_name'>>(db, userId, input.persona, 'id, display_name') : null
  const who = person?.display_name ?? 'todo el equipo'
  const day = await findExcusedDay(db, input.fecha, person?.id ?? null)
  if (!day) throw new ToolError(`El ${input.fecha} no está justificado para ${who}.`)
  return {
    id: day.id,
    entity: { key: 'dia_justificado', value: { fecha: day.work_date, tipo: EXCUSE_TOKENS.toToken(day.kind), para: who, nota: day.note } },
    avisos: ['Ese día vuelve a pedir su jornada completa en el objetivo de la semana.'],
    fingerprint: { id: day.id, kind: day.kind, note: day.note },
    subject: `El día justificado del ${day.work_date}`,
  }
}

/** Reads what would be lost and what blocks it; nothing is written. */
export async function planDeleteRecord(db: Db, userId: string, input: DeleteRecordInput): Promise<WritePlan<Carry>> {
  const finders: Record<RecordType, () => Promise<Found>> = {
    proveedor: () => findSupplier(db, input),
    marca: () => findBrand(db, input),
    medida: () => findMeasure(db, input),
    factura: () => findPayable(db, input),
    checada: () => findPunch(db, userId, input),
    dia_justificado: () => findExcused(db, userId, input),
  }
  const { id, ...found } = await finders[input.tipo]()
  return { ...found, carry: { tipo: input.tipo, id } }
}

const deleters: Record<RecordType, (db: Db, id: string) => Promise<void>> = {
  proveedor: deleteSupplier,
  marca: deleteBrand,
  medida: deleteMaterialPresentation,
  factura: deletePayable,
  checada: deleteTimeEntry,
  dia_justificado: deleteExcusedDay,
}

export async function commitDeleteRecord(db: Db, plan: WritePlan<Carry>) {
  await deleters[plan.carry.tipo](db, plan.carry.id)
  return writeResult('borrado', plan.entity.key, plan.entity.value, { avisos: plan.avisos, nota: 'Borrado.' })
}
