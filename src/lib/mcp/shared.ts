/** Re-exports the core (#155 A2) so tools keep their imports until they move to their connector in A3. */

export type { Db } from './core/db'
export { ToolError } from './core/errors'
export { normalizePagination } from './core/schema'
export { requireSingleMatch } from './core/lookup'
export { isAdminNow, requireLiveAdmin, LIVE_ADMIN_READ_TIMEOUT_MS } from './core/auth/live-admin'
export { withResultMeta, splitResultMeta, type ResultMeta, type ResultWithMeta } from './core/result'
export { sanitizeSearch, isUuid, fold } from '@/lib/text'
