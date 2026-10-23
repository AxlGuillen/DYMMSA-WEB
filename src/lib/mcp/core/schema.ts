import { z } from 'zod'

/** Read-only — every tool except the scoped writes of ADR-015. */
export const readOnly = { readOnlyHint: true, openWorldHint: false } as const

export const pagination = {
  page: z.number().int().min(1).optional().describe('Página (1-indexada, default 1)'),
  pageSize: z.number().int().min(1).max(100).optional().describe('Resultados por página (default 20, máx 100)'),
}

/** 1-indexed page, capped size — same limits as the API routes. */
export function normalizePagination(input: { page?: number; pageSize?: number }, defaultSize = 20) {
  const page = Math.max(1, Math.floor(input.page ?? 1))
  const pageSize = Math.min(100, Math.max(1, Math.floor(input.pageSize ?? defaultSize)))
  return { page, pageSize, from: (page - 1) * pageSize, to: page * pageSize - 1 }
}
