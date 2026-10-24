import { z } from 'zod'
import { isRealDate } from '@/lib/month'
import { inputErrorMessage, SAMPLES, type InputIssue } from './input-error'
import { ToolError } from './errors'

/** The value the input error's example uses when the type alone can't make a valid one (a regex, a folio). */
export function withSample<S extends z.ZodType>(schema: S, sample: unknown): S {
  SAMPLES.add(schema, { sample })
  return schema
}

/** Shape AND existence (#155 C1): 2026-02-30 passes a regex and Postgres answers 22008. */
export const isoDate = withSample(
  z.string().refine((value) => isRealDate(value), 'no es una fecha que exista (YYYY-MM-DD)').meta({ format: 'date' }),
  '2026-01-31',
)

export const isoMonth = withSample(z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'no es un mes (YYYY-MM)'), '2026-01')

/** Optional, capped list size; the handler applies the default. The text carries both: never `.describe()` over it. */
export const limit = (max: number, fallback: number, what?: string) =>
  z.number().int().min(1).max(max).optional().describe(`Máx ${max}${what ? ` ${what}` : ''} (default ${fallback})`)

/** 1-indexed page; `note` adds to the text instead of replacing it (e.g. the page size). */
export const page = (note?: string) =>
  z.number().int().min(1).optional().describe(`Página (1-indexada, default 1${note ? `; ${note}` : ''})`)

/** The standard collection input (plan §4.4, #155 C6): `pagina` from 1, `por_pagina` default 20, at most 100. */
export const pagination = {
  pagina: page(),
  por_pagina: z.number().int().min(1).max(100).optional().describe('Resultados por página (default 20, máx 100)'),
}

/** 1-indexed page, capped size — same limits as the API routes. */
export function normalizePagination(input: { pagina?: number; por_pagina?: number }, defaultSize = 20) {
  const pagina = Math.max(1, Math.floor(input.pagina ?? 1))
  const por_pagina = Math.min(100, Math.max(1, Math.floor(input.por_pagina ?? defaultSize)))
  return { pagina, por_pagina, from: (pagina - 1) * por_pagina, to: pagina * por_pagina - 1 }
}

export type InputOf<S extends z.ZodRawShape> = z.infer<z.ZodObject<S, z.core.$strict>>

type StrictInput<S extends z.ZodRawShape> = z.ZodObject<S, z.core.$strict>

const strictInputs = new WeakMap<z.ZodRawShape, Map<string, StrictInput<z.ZodRawShape>>>()

/** The registered input (#155 C1, ADR-041): unknown fields are errors. Its last check runs even after other
 *  issues and throws the Spanish message, which the SDK answers alone, without its English prefix. */
export function strictInput<S extends z.ZodRawShape>(tool: string, shape: S): StrictInput<S> {
  const byTool = strictInputs.get(shape) ?? new Map<string, StrictInput<z.ZodRawShape>>()
  strictInputs.set(shape, byTool)
  const cached = byTool.get(tool)
  if (cached) return cached as unknown as StrictInput<S>

  const plain = z.strictObject(shape)
  const report = z.core._check<unknown>(
    (payload) => {
      if (payload.issues.length === 0) return
      throw new ToolError(inputErrorMessage(tool, plain, payload.value, payload.issues as InputIssue[]))
    },
    { when: () => true },
  )
  const schema = plain.check(report)
  byTool.set(tool, schema as unknown as StrictInput<z.ZodRawShape>)
  return schema
}

/** The SDK already parsed with strictInput; this keeps direct calls (tests, scripts) to the same contract. */
export function parseInput<S extends z.ZodRawShape>(tool: string, shape: S, raw: unknown): InputOf<S> {
  return strictInput(tool, shape).parse(raw)
}
