/** Supplier size catalog writes shared by /api/material-presentations and the MCP (#155 C6): the catalog builds itself from captures. */

import type { SupabaseClient } from '@supabase/supabase-js'
import { DomainError, type DomainErrorKind } from '@/lib/domain-error'
import { PRESENTATION_KEY, type PresentationRow } from '@/lib/cut-plan'
import { isUuid } from '@/lib/text'
import type { MaterialPresentation } from '@/types/database'

export class MaterialError extends DomainError {
  constructor(message: string, kind: DomainErrorKind = 'invalid') {
    super(message, kind)
    this.name = 'MaterialError'
  }
}

/** The row with this identity (UNIQUE NULLS NOT DISTINCT: a null column is matched with IS NULL), if registered. */
export async function findPresentation(db: SupabaseClient, row: PresentationRow): Promise<{ id: string } | null> {
  let lookup = db.from('material_presentations').select('id')
  for (const column of PRESENTATION_KEY.split(',') as (keyof PresentationRow)[]) {
    lookup = row[column] === null ? lookup.is(column, null) : lookup.eq(column, row[column])
  }
  const { data, error } = await lookup.limit(1).maybeSingle()
  if (error) {
    console.error('Error reading material presentations:', error)
    throw new MaterialError('Error al leer las medidas', 'failed')
  }
  return (data as { id: string } | null) ?? null
}

/** Upsert on the identity + refresh last_used_at. */
export async function upsertPresentation(db: SupabaseClient, row: PresentationRow): Promise<MaterialPresentation> {
  const { data, error } = await db
    .from('material_presentations')
    .upsert({ ...row, last_used_at: new Date().toISOString() }, { onConflict: PRESENTATION_KEY })
    .select()
    .single()
  if (error || !data) {
    console.error('material-presentations upsert error:', error)
    throw new MaterialError('Error al guardar la presentación', 'failed')
  }
  return data as MaterialPresentation
}

/** DELETE /api/material-presentations/[id] and delete_record: drops a mistyped capture (#71); nothing references presentations. */
export async function deleteMaterialPresentation(db: SupabaseClient, id: string): Promise<void> {
  if (!isUuid(id)) throw new MaterialError('Medida no encontrada', 'not_found')
  const { data, error } = await db.from('material_presentations').delete().eq('id', id).select('id')
  if (error) {
    console.error('material-presentations DELETE error:', error)
    throw new MaterialError('Error al eliminar la medida', 'failed')
  }
  if (!data || data.length === 0) throw new MaterialError('Medida no encontrada', 'not_found')
}
