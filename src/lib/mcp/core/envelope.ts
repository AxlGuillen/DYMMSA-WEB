// The standard answers, keys from plan §4 (#155 C3, ADR-041 §9). Existing tools adopt them when C6 merges or
// renames them, never in passing, so routines break only once.

import { z } from 'zod'
import { isUuid } from '@/lib/text'
import { hashOf } from './confirm/canonical'

// Optional keys travel only when they say something (R11): absence = nothing to say.
const said = <K extends string, V>(key: K, value: V | null | undefined): Partial<Record<K, V>> =>
  value === undefined || value === null || (Array.isArray(value) && value.length === 0) ? {} : ({ [key]: value } as Record<K, V>)

function assertFree(key: string, reserved: readonly string[], helper: string): void {
  if (reserved.includes(key)) throw new Error(`${helper}: "${key}" is an envelope key`)
}

/** ref (plan §4): the first 8 hex characters of a UUID, to show; the by-id resolvers accept it from C6, until then they need the full UUID. */
export function refOf(id: string): string {
  if (!isUuid(id)) throw new Error(`refOf: "${id}" is not a UUID`)
  return id.slice(0, 8).toLowerCase()
}

/**
 * version (plan §4.5, #155 C6): a short fingerprint of a document's line ids and its updated_at, so a later
 * edit can pin what it read. A line moved, added or removed, or the document touched, changes it.
 */
export function versionOf(updatedAt: string, lineIds: readonly string[]): string {
  return hashOf({ ids: lineIds, updated_at: updatedAt }).slice(0, 12)
}

export const LIST_KEYS =['total', 'pagina', 'por_pagina', 'hay_mas', 'nota'] as const
type ListKey = (typeof LIST_KEYS)[number]

export interface Page {
  readonly total: number
  /** 1-based. */
  readonly pagina: number
  readonly por_pagina: number
}

export type ListResult<K extends string, T> = {
  total: number
  pagina: number
  por_pagina: number
  hay_mas: boolean
  nota?: string
} & { [P in K]: T[] }

/** Collection: hay_mas comes from the numbers, so it cannot contradict them; the default nota says how to ask for more. */
export function listResult<K extends string, T>(key: Exclude<K, ListKey>, items: readonly T[], page: Page, nota?: string | null): ListResult<K, T> {
  assertFree(key, LIST_KEYS, 'listResult')
  const { total, pagina, por_pagina } = page
  const rest = total - ((pagina - 1) * por_pagina + items.length)
  const hay_mas = rest > 0
  const note = nota ?? (hay_mas ? `Hay ${rest} más: pide pagina=${pagina + 1}.` : null)
  return { total, pagina, por_pagina, hay_mas, ...said('nota', note), [key]: [...items] } as ListResult<K, T>
}

export const RECORD_KEYS = ['ref', 'avisos', 'nota'] as const
type RecordKey = (typeof RECORD_KEYS)[number]

export interface RecordDetails {
  /** refOf(uuid) in DYMMSA-WEB; a folio where the source has one. */
  readonly ref?: string
  readonly avisos?: readonly string[]
  readonly nota?: string | null
}

export type RecordResult<T extends object> = { ref?: string } & T & { avisos?: string[]; nota?: string }

/** Record: the module already presented it (names, resolved values); this only fixes where ref, avisos and nota go. */
export function recordResult<T extends object & { readonly [P in RecordKey]?: never }>(fields: T, details: RecordDetails = {}): RecordResult<T> {
  for (const key of Object.keys(fields)) assertFree(key, RECORD_KEYS, 'recordResult')
  return {
    ...said('ref', details.ref),
    ...fields,
    ...said('avisos', details.avisos && [...details.avisos]),
    ...said('nota', details.nota),
  } as RecordResult<T>
}

/** simulado = phase 1 of a two-phase write (C4); ya_existia = an idempotent create that found its twin. */
export const WRITE_ACTIONS = ['simulado', 'creado', 'actualizado', 'borrado', 'sin_cambios', 'ya_existia'] as const
export type WriteAction = (typeof WRITE_ACTIONS)[number]
const WRITTEN: ReadonlySet<WriteAction> = new Set(['creado', 'actualizado', 'borrado'])

export const WRITE_KEYS = ['accion', 'escrito', 'cambios', 'avisos', 'bloqueos', 'clave', 'vence', 'nota'] as const
type WriteKey = (typeof WRITE_KEYS)[number]

export interface Change {
  readonly antes: unknown
  readonly ahora: unknown
}
export type Changes = Readonly<Record<string, Change>>

export interface WriteDetails {
  readonly cambios?: Changes
  readonly avisos?: readonly string[]
  readonly bloqueos?: readonly string[]
  readonly clave?: string | null
  readonly vence?: string | null
  readonly nota?: string | null
}

export type WriteResult<K extends string, E> = { accion: WriteAction; escrito: boolean } & { [P in K]: E } & {
  cambios?: Changes
  avisos?: string[]
  bloqueos?: string[]
  clave?: string
  vence?: string
  nota?: string
}

/** Write: escrito comes from the action, so a simulated or unchanged write can never claim it wrote. */
export function writeResult<K extends string, E>(accion: WriteAction, key: Exclude<K, WriteKey>, entity: E, details: WriteDetails = {}): WriteResult<K, E> {
  assertFree(key, WRITE_KEYS, 'writeResult')
  const cambios = details.cambios && Object.keys(details.cambios).length > 0 ? details.cambios : undefined
  return {
    accion,
    escrito: WRITTEN.has(accion),
    [key]: entity,
    ...said('cambios', cambios),
    ...said('avisos', details.avisos && [...details.avisos]),
    ...said('bloqueos', details.bloqueos && [...details.bloqueos]),
    ...said('clave', details.clave),
    ...said('vence', details.vence),
    ...said('nota', details.nota),
  } as WriteResult<K, E>
}

const sameJson = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b)

/** antes/ahora of every field that changed between two presented records (generalizes update_payable). */
export function diff(before: object, after: object, ignore: readonly string[] = []): Changes {
  const was = before as Record<string, unknown>
  const now = after as Record<string, unknown>
  const keys = [...new Set([...Object.keys(now), ...Object.keys(was)])].filter((key) => !ignore.includes(key))
  const changes: Record<string, Change> = {}
  for (const key of keys) {
    // JSON has no undefined: a field that appears or disappears reads as null.
    const antes = was[key] ?? null
    const ahora = now[key] ?? null
    if (!sameJson(antes, ahora)) changes[key] = { antes, ahora }
  }
  return changes
}

/** The preview envelope (§3.5): what a view and the phase-2 call rely on, whatever the tool previews. */
export const previewEnvelope = {
  puede_guardar: z.boolean(),
  bloqueos: z.array(z.string()),
  avisos: z.array(z.string()),
  clave: z.string().nullable(),
  vence: z.string().nullable(),
  siguiente_paso: z.string(),
}
