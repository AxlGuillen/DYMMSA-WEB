/** The Spanish input error (#155 C1, ADR-041): what failed, what to fix and a valid example. It leans on zod internals
 *  (z.core._check, finalizeIssue, _zod.def/bag/optin) a minor zod bump can move: the real-SDK harness tests are the net. */

import { z } from 'zod'
import { fold } from '@/lib/text'

type Schema = z.core.$ZodType
export type InputIssue = z.core.$ZodRawIssue

/** A valid value for the example when the type alone can't make one (a regex, a folio). */
export const SAMPLES = z.registry<{ sample: unknown }>()

// Per message, never z.config(): a global locale would also change the app routes' zod messages.
const es = z.locales.es()

const MAX_PROBLEMS = 3
const MAX_EXAMPLE = 300

// The def fields this walker reads; zod types them per schema kind.
interface WalkDef {
  type: string
  innerType?: Schema
  in?: Schema
  shape?: Record<string, Schema>
  element?: Schema
  items?: Schema[]
  options?: Schema[]
  entries?: Record<string, unknown>
  values?: unknown[]
}

interface NumberBag {
  minimum?: number
  maximum?: number
  exclusiveMinimum?: number
  format?: string
}

const defOf = (s: Schema) => s._zod.def as unknown as WalkDef
const WRAPPERS = new Set(['optional', 'nullable', 'default', 'prefault', 'readonly', 'catch', 'nonoptional'])

function unwrapOnce(s: Schema): Schema {
  const def = defOf(s)
  if (WRAPPERS.has(def.type) && def.innerType) return def.innerType
  if (def.type === 'pipe' && def.in) return def.in
  return s
}

function unwrap(s: Schema): Schema {
  let cur = s
  while (unwrapOnce(cur) !== cur) cur = unwrapOnce(cur)
  return cur
}

const isOptional = (s: Schema) => s._zod.optin === 'optional'

function childOf(s: Schema | undefined, key: PropertyKey): Schema | undefined {
  if (!s) return undefined
  const def = defOf(unwrap(s))
  if (def.type === 'object') return def.shape?.[String(key)]
  if (def.type === 'array') return def.element
  if (def.type === 'tuple') return def.items?.[Number(key)]
  return undefined
}

const schemaAt = (root: Schema, path: readonly PropertyKey[]) => path.reduce<Schema | undefined>(childOf, root)

function shapeAt(root: Schema, path: readonly PropertyKey[]): Record<string, Schema> | null {
  const node = schemaAt(root, path)
  const def = node ? defOf(unwrap(node)) : null
  return def?.type === 'object' && def.shape ? def.shape : null
}

function numberSample(s: Schema): number {
  const bag = s._zod.bag as NumberBag
  const int = bag.format === 'safeint'
  let value = bag.exclusiveMinimum !== undefined ? bag.exclusiveMinimum + 1 : bag.minimum
  if (value === undefined || value < -1e6) value = 1
  if (bag.maximum !== undefined && value > bag.maximum) value = bag.maximum
  return int ? Math.ceil(value) : value
}

function sampleOf(s: Schema, depth = 0): unknown {
  for (let cur = s; ; ) {
    const meta = SAMPLES.get(cur)
    if (meta) return meta.sample
    const next = unwrapOnce(cur)
    if (next === cur) break
    cur = next
  }
  const inner = unwrap(s)
  const def = defOf(inner)
  switch (def.type) {
    case 'string':
      return 'texto'
    case 'number':
      return numberSample(inner)
    case 'boolean':
      return true
    case 'enum':
      return Object.values(def.entries ?? {})[0]
    case 'literal':
      return def.values?.[0]
    case 'array':
      return def.element && depth < 4 ? [sampleOf(def.element, depth + 1)] : []
    case 'tuple':
      return (def.items ?? []).map((item) => sampleOf(item, depth + 1))
    case 'union':
      return def.options?.[0] ? sampleOf(def.options[0], depth) : null
    case 'object':
      return depth < 4 ? requiredSample(def.shape ?? {}, {}, depth + 1) : {}
    default:
      return 'valor'
  }
}

function requiredSample(shape: Record<string, Schema>, into: Record<string, unknown>, depth = 0): Record<string, unknown> {
  for (const [key, field] of Object.entries(shape)) {
    if (!isOptional(field) && !(key in into)) into[key] = sampleOf(field, depth)
  }
  return into
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

type Container = Record<PropertyKey, unknown>

function getAt(target: unknown, path: readonly PropertyKey[]): unknown {
  return path.reduce<unknown>((cur, key) => (typeof cur === 'object' && cur !== null ? (cur as Container)[key] : undefined), target)
}

function setAt(target: Container, path: readonly PropertyKey[], value: unknown): void {
  let cur = target
  path.forEach((key, i) => {
    if (i === path.length - 1) {
      cur[key] = value
      return
    }
    if (typeof cur[key] !== 'object' || cur[key] === null) cur[key] = typeof path[i + 1] === 'number' ? [] : {}
    cur = cur[key] as Container
  })
}

function deleteAt(target: Container, path: readonly PropertyKey[]): void {
  const parent = getAt(target, path.slice(0, -1))
  const key = path[path.length - 1]
  // Two issues in one array can shift indexes: harmless, the example is validated and falls back to the minimal one.
  if (Array.isArray(parent) && typeof key === 'number') parent.splice(key, 1)
  else if (isRecord(parent)) delete parent[String(key)]
}

/** A sample the field accepts, or null: a regex like the SAT key's is never invented (#154). */
function validSample(field: Schema): { value: unknown } | null {
  const value = sampleOf(field)
  return z.safeParse(field, value).success ? { value } : null
}

/** Puts a valid sample at a failing path; an optional field without one leaves the example. */
function repair(base: Container, root: Schema, path: readonly PropertyKey[]): void {
  const field = schemaAt(root, path)
  // A value an unknown key already moved here (model → modelo) is the caller's, and it is valid.
  if (!field || (getAt(base, path) !== undefined && z.safeParse(field, getAt(base, path)).success)) return
  const sample = validSample(field)
  if (sample) setAt(base, path, sample.value)
  else if (isOptional(field)) deleteAt(base, path)
}

function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    let diagonal = row[0]
    row[0] = i
    for (let j = 1; j <= b.length; j++) {
      const above = row[j]
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1))
      diagonal = above
    }
  }
  return row[b.length]
}

/** A typo of a valid field («fecha_pagos» → «fecha_pago»), or null: never a guess between far names. */
function suggest(key: string, candidates: readonly string[]): string | null {
  let best: string | null = null
  let bestDistance = Infinity
  for (const candidate of candidates) {
    const d = distance(fold(key), fold(candidate))
    if (d < bestDistance) [best, bestDistance] = [candidate, d]
  }
  return bestDistance <= Math.max(1, Math.floor(key.length / 3)) ? best : null
}

/** The caller's own input, corrected: unknown keys renamed to their likely field or dropped, bad values sampled. */
function corrected(root: Schema, input: unknown, issues: readonly InputIssue[]): Container {
  const base: Container = isRecord(input) ? structuredClone(input) : {}
  // Renames first: a missing «modelo» is often the «model» the caller did send.
  const ordered = [...issues].sort((a, b) => Number(b.code === 'unrecognized_keys') - Number(a.code === 'unrecognized_keys'))
  for (const issue of ordered) {
    const path = issue.path ?? []
    if (issue.code === 'unrecognized_keys') {
      const parent = getAt(base, path)
      const shape = shapeAt(root, path)
      if (!isRecord(parent)) continue
      for (const key of issue.keys) {
        // zod's output already dropped the unknown key: its value travels in the issue's input.
        const value = isRecord(issue.input) ? issue.input[key] : undefined
        delete parent[key]
        const guess = shape ? suggest(key, Object.keys(shape)) : null
        if (!guess || !shape || guess in parent) continue
        if (z.safeParse(shape[guess], value).success) parent[guess] = value
        else repair(base, root, [...path, guess])
      }
    } else if (path.length > 0) {
      repair(base, root, path)
    }
  }
  return requiredSample(shapeAt(root, []) ?? {}, base)
}

/** Only what the call needs: the required fields plus the ones that failed. */
function minimal(root: Schema, issues: readonly InputIssue[]): Container {
  const base: Container = {}
  for (const issue of issues) {
    const path = issue.path ?? []
    if (issue.code === 'unrecognized_keys') {
      const shape = shapeAt(root, path)
      for (const key of issue.keys) {
        const guess = shape ? suggest(key, Object.keys(shape)) : null
        if (guess) repair(base, root, [...path, guess])
      }
    } else if (path.length > 0) {
      repair(base, root, path)
    }
  }
  const shape = shapeAt(root, []) ?? {}
  requiredSample(shape, base)
  // A tool without required fields still shows how a call looks.
  const first = Object.keys(shape).find((key) => validSample(shape[key]))
  if (Object.keys(base).length === 0 && first) repair(base, root, [first])
  return base
}

function example(root: Schema, input: unknown, issues: readonly InputIssue[]): string | null {
  for (const candidate of [corrected(root, input, issues), minimal(root, issues)]) {
    const text = JSON.stringify(candidate)
    if (text.length <= MAX_EXAMPLE && z.safeParse(root, candidate).success) return text
  }
  return null
}

/** 'debe ser al menos 0' / 'lleva hasta 80 elementos': clearer than the locale's «>=». */
function boundReason(origin: string, limit: number | bigint, side: 'min' | 'max', inclusive: boolean): string {
  const count = (one: string, many: string) => `${limit} ${limit === 1 ? one : many}`
  if (origin === 'string') return `lleva ${side === 'min' ? 'al menos' : 'hasta'} ${count('carácter', 'caracteres')}`
  if (origin === 'array') return `lleva ${side === 'min' ? 'al menos' : 'hasta'} ${count('elemento', 'elementos')}`
  if (side === 'min') return `debe ser ${inclusive ? 'al menos' : 'mayor que'} ${limit}`
  return `debe ser ${inclusive ? 'a lo más' : 'menor que'} ${limit}`
}

const reasons: z.core.$ZodErrorMap = (issue) => {
  if (issue.code === 'too_small') return boundReason(issue.origin, issue.minimum, 'min', issue.inclusive !== false)
  if (issue.code === 'too_big') return boundReason(issue.origin, issue.maximum, 'max', issue.inclusive !== false)
  return undefined
}

const pathText = (path: readonly PropertyKey[]) => path.map(String).join('.')
const quoted = (names: readonly string[]) => names.map((name) => `«${name}»`).join(', ')

const isMissing = (issue: InputIssue) => issue.code === 'invalid_type' && issue.input === undefined && (issue.path ?? []).length > 0

function problem(issue: InputIssue, root: Schema): string {
  const path = issue.path ?? []
  const at = path.length ? ` en «${pathText(path)}»` : ''
  if (issue.code === 'unrecognized_keys') {
    const shape = shapeAt(root, path)
    const guesses = shape ? issue.keys.map((key) => suggest(key, Object.keys(shape))).filter((g): g is string => g !== null) : []
    const noun = issue.keys.length === 1 ? `el campo ${quoted(issue.keys)} no existe` : `los campos ${quoted(issue.keys)} no existen`
    return `${noun}${at}${guesses.length ? ` (¿quisiste decir ${quoted(guesses)}?)` : ''}`
  }
  // Custom messages win, then the clearer bounds, then zod's Spanish locale.
  const { message } = z.core.util.finalizeIssue(issue, { error: reasons }, { localeError: es.localeError })
  return path.length ? `«${pathText(path)}»: ${message}` : message
}

/** Unknown fields first (the fix lists the valid ones), then every missing field in one phrase, then the rest. */
function problems(issues: readonly InputIssue[], root: Schema): string[] {
  const missing = issues.filter(isMissing).map((issue) => pathText(issue.path ?? []))
  const missingPhrase = missing.length === 1 ? `falta «${missing[0]}», que es obligatorio` : `faltan ${quoted(missing)}, que son obligatorios`
  return [
    ...issues.filter((issue) => issue.code === 'unrecognized_keys').map((issue) => problem(issue, root)),
    ...(missing.length ? [missingPhrase] : []),
    ...issues.filter((issue) => issue.code !== 'unrecognized_keys' && !isMissing(issue)).map((issue) => problem(issue, root)),
  ]
}

function fix(issues: readonly InputIssue[], root: Schema): string {
  const unknownAt = issues.filter((i) => i.code === 'unrecognized_keys').map((i) => i.path ?? [])
  if (unknownAt.length) {
    return unknownAt
      .map((path) => {
        const shape = shapeAt(root, path) ?? {}
        const names = Object.keys(shape)
        const required = names.filter((name) => !isOptional(shape[name]))
        const where = path.length ? ` en «${pathText(path)}»` : ''
        const valid = names.length ? `Campos válidos${where}: ${names.join(', ')}` : `No lleva campos${where}`
        return `${valid}${required.length ? `; obligatorios: ${required.join(', ')}` : ''}.`
      })
      .join(' ')
  }
  if (issues.some(isMissing)) return 'Agrega lo que falta y repite la llamada.'
  return 'Corrige ese valor y repite la llamada.'
}

/** «Entrada inválida en <tool>: <qué falló>. <qué corregir>. Ej.: <entrada válida>». */
export function inputErrorMessage(tool: string, root: Schema, input: unknown, issues: readonly InputIssue[]): string {
  const all = problems(issues, root)
  const shown = all.slice(0, MAX_PROBLEMS)
  const more = all.length > MAX_PROBLEMS ? ` (y ${all.length - MAX_PROBLEMS} más)` : ''
  const sample = example(root, input, issues)
  return `Entrada inválida en ${tool}: ${shown.join('; ')}${more}. ${fix(issues, root)}${sample ? ` Ej.: ${sample}` : ''}`
}
