/**
 * save_profile (#155 D, ADR-041): name, NSS, clock id, shift or area of a person. Never the role (decision 8) and never
 * the hourly rate (2026-10-05): the schema has no such field, and the store call never asks for the pay table.
 * One's own name and NSS write directly; anything about someone else, or the clock id, shift and area, asks for the yes.
 */

import type { WritePlan } from '@/lib/mcp/core/define'
import { diff, refOf, writeResult } from '@/lib/mcp/core/envelope'
import { ToolError } from '@/lib/mcp/core/errors'
import type { Db } from '@/lib/mcp/core/db'
import { maskNss } from '@/lib/nss'
import { AREA_TOKENS, ROLE_TOKENS } from '@/lib/profile'
import { parseAdminProfileUpdate, updateProfileAsAdmin } from '@/lib/profiles-store'
import { SHIFT_TOKENS } from '@/lib/timesheet'
import type { Profile, ProfileUpdate } from '@/types/database'
import { resolvePerson } from './profiles'

export interface SaveProfileInput {
  /** Name or ref; absent = yourself. */
  persona?: string
  nombre?: string
  /** Empty text clears it. */
  nss?: string
  /** null = does not clock in. */
  id_checador?: number | null
  /** completa | media | ninguna. */
  jornada?: string
  area?: string
}

type Row = Pick<Profile, 'id' | 'display_name' | 'role' | 'area' | 'clock_employee_id' | 'shift' | 'nss' | 'is_owner' | 'updated_at'>
const COLUMNS = 'id, display_name, role, area, clock_employee_id, shift, nss, is_owner, updated_at'

/** The NSS is personal data: it never goes back whole into the chat history (Auditoría DYMMSA-WEB §Equipo). */
const masked = (nss: string | null) => (nss ? maskNss(nss) : null)

function present(row: Row) {
  return {
    ref: refOf(row.id),
    nombre: row.display_name,
    rol: ROLE_TOKENS.toToken(row.role),
    area: AREA_TOKENS.toToken(row.area),
    jornada: row.shift ? SHIFT_TOKENS.toToken(row.shift) : null,
    id_checador: row.clock_employee_id,
    nss: masked(row.nss),
  }
}

/** What the cambios show: the same names as the answer, the NSS masked on both sides. */
function view(row: Row) {
  const { nombre, area, jornada, id_checador, nss } = present(row)
  return { nombre, area, jornada, id_checador, nss }
}

function bodyFrom(input: SaveProfileInput): ProfileUpdate {
  const body: ProfileUpdate = {}
  if (input.nombre !== undefined) body.display_name = input.nombre
  if (input.nss !== undefined) body.nss = input.nss
  if (input.id_checador !== undefined) body.clock_employee_id = input.id_checador
  if (input.jornada !== undefined) {
    if (input.jornada === 'ninguna') body.shift = null
    else {
      const shift = SHIFT_TOKENS.toDb(input.jornada)
      if (!shift) throw new ToolError(`Jornada inválida "${input.jornada}": usa ${[...SHIFT_TOKENS.tokens, 'ninguna'].join(' | ')}`)
      body.shift = shift
    }
  }
  if (input.area !== undefined) {
    const area = AREA_TOKENS.toDb(input.area)
    if (!area) throw new ToolError(`Área inválida "${input.area}": usa ${AREA_TOKENS.tokens.join(' | ')}`)
    body.area = area
  }
  return body
}

interface Carry {
  person: Row
  updates: Record<string, unknown>
}

const OWN_DIRECT = new Set(['display_name', 'nss'])

export async function planSaveProfile(db: Db, userId: string, input: SaveProfileInput): Promise<WritePlan<Carry>> {
  const person = await resolvePerson<Row>(db, userId, input.persona, COLUMNS)
  const body = bodyFrom(input)
  if (Object.keys(body).length === 0) throw new ToolError('Indica qué cambiar: nombre, nss, id_checador, jornada o area.')
  // Same validation as the route: name length, NSS check digit, whole clock id.
  const { updates: parsed } = parseAdminProfileUpdate(body)
  const current = person as unknown as Record<string, unknown>
  const updates = Object.fromEntries(Object.entries(parsed).filter(([key, value]) => current[key] !== value))

  const own = person.id === userId
  const avisos: string[] = []
  const bloqueos: string[] = []
  if ('clock_employee_id' in updates) {
    const id = updates.clock_employee_id as number | null
    if (id === null) avisos.push(`${person.display_name} quedará sin id de checador: en el próximo reporte aparece sin perfil. Las checadas ya cargadas no se mueven.`)
    else {
      avisos.push(`El próximo reporte del checador asignará el id ${id} a ${person.display_name}; las checadas ya cargadas no se mueven.`)
      const { data, error } = await db.from('profiles').select('display_name').eq('clock_employee_id', id).neq('id', person.id).limit(1)
      if (error) throw new ToolError('No se pudieron leer los perfiles')
      const taken = (data ?? [])[0] as { display_name: string } | undefined
      if (taken) bloqueos.push(`El id ${id} del checador ya lo tiene ${taken.display_name}.`)
    }
  }
  if ('shift' in updates) avisos.push('Cambia su objetivo semanal y el pago estimado de la oficina; su jornada de nómina es otra (save_payroll_employee).')
  if ('area' in updates) avisos.push('Cambia cómo se paga su sábado en Nómina en los cortes abiertos; los cerrados conservan su área.')
  if ('display_name' in updates) avisos.push('Es el nombre con que el equipo lo ve y con que se le busca aquí.')

  const after = { ...person, ...updates } as Row
  return {
    entity: { key: 'persona', value: present(after) },
    cambios: diff(view(person), view(after)),
    avisos,
    bloqueos: bloqueos.length > 0 ? bloqueos : undefined,
    sinCambios: Object.keys(updates).length === 0,
    directo: own && Object.keys(updates).every((key) => OWN_DIRECT.has(key)),
    // updated_at moves with the write (trigger), so a repeated key meets another fingerprint.
    fingerprint: { id: person.id, updated_at: person.updated_at, ...view(person) },
    subject: own ? 'Tu perfil' : `El perfil de ${person.display_name}`,
    carry: { person, updates },
  }
}

export async function commitSaveProfile(db: Db, plan: WritePlan<Carry>) {
  const { person, updates } = plan.carry
  // No select with the pay table: the rate never travels through the MCP.
  const saved = (await updateProfileAsAdmin(db, person.id, updates as ProfileUpdate, COLUMNS)) as Row
  return writeResult('actualizado', 'persona', present(saved), { cambios: plan.cambios, avisos: plan.avisos })
}
