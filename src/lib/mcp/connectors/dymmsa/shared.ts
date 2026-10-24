import type { ReadHints } from '@/lib/mcp/core/define'

/** A closed domain (Auditoría DYMMSA-WEB §3, #155 C2): the app's own DB and repo; Odoo only behind get_month_closing. */
export const dymmsaRead: ReadHints = { openWorldHint: false }
